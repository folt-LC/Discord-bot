import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Readable } from "node:stream";
import type { Logger } from "pino";
import {
  GetBotConnectionResponse,
  GetBotLogsResponse,
  GetBotUsageResponse,
} from "@workspace/api-zod";
import { logger } from "./logger";

const PROFILER_PREFIX = "MENDIVE_PROFILER_SNAPSHOT ";
const MAX_LOG_ENTRIES = 250;
const MAX_USAGE_SAMPLES = 180;
const USAGE_RETENTION_MINUTES = 30;

export type BotState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export interface ManagedBotStatus {
  state: BotState;
  gatewayConnected: boolean;
  processId: number | null;
  startedAt: string | null;
  uptimeSeconds: number;
  lastExitCode: number | null;
  lastError: string | null;
}

type BotUsage = ReturnType<typeof GetBotUsageResponse.parse>;
type ProfilerSample = NonNullable<BotUsage["current"]>;
type BotLogEntry = ReturnType<typeof GetBotLogsResponse.parse>["entries"][number];
type BotConnection = ReturnType<typeof GetBotConnectionResponse.parse>;

function sanitizeLogMessage(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(
      /\b(token|password|secret|authorization)\s*[:=]\s*["']?[^,\s"']+/gi,
      "$1=[redacted]",
    )
    .replace(/\b[\w-]{24}\.[\w-]{6}\.[\w-]{27}\b/g, "[redacted Discord token]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, 1_200);
}

function findBotEntry(): string | null {
  const candidates = [
    resolve(process.cwd(), "discord-bot/src/index.js"),
    resolve(process.cwd(), "../../discord-bot/src/index.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

class BotProcessManager {
  private readonly logger: Logger;
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private state: BotState = "stopped";
  private gatewayConnected = false;
  private startedAt: Date | null = null;
  private lastExitCode: number | null = null;
  private lastError: string | null = null;
  private stopping = false;
  private actionQueue: Promise<unknown> = Promise.resolve();
  private readonly logs: BotLogEntry[] = [];
  private readonly usageHistory: ProfilerSample[] = [];
  private currentUsage: ProfilerSample | null = null;
  private readonly shardIds = new Set<number>();
  private botUsername: string | null = null;
  private gatewayConnectedAt: Date | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  start(): Promise<ManagedBotStatus> {
    return this.enqueue(() => this.startNow());
  }

  stop(): Promise<ManagedBotStatus> {
    return this.enqueue(() => this.stopNow());
  }

  getStatus(): ManagedBotStatus {
    const isActive =
      this.state === "running" ||
      this.state === "starting" ||
      this.state === "stopping";
    const uptimeSeconds =
      isActive && this.startedAt
        ? Math.max(0, Math.floor((Date.now() - this.startedAt.getTime()) / 1000))
        : 0;

    return {
      state: this.state,
      gatewayConnected: this.gatewayConnected,
      processId: this.child?.pid ?? null,
      startedAt: this.startedAt?.toISOString() ?? null,
      uptimeSeconds,
      lastExitCode: this.lastExitCode,
      lastError: this.lastError,
    };
  }

  getLogs(): { entries: BotLogEntry[] } {
    return GetBotLogsResponse.parse({
      entries: this.logs.slice(-MAX_LOG_ENTRIES),
    });
  }

  getUsage(): BotUsage {
    return GetBotUsageResponse.parse({
      current: this.currentUsage,
      history: this.usageHistory.slice(-MAX_USAGE_SAMPLES),
      retentionMinutes: USAGE_RETENTION_MINUTES,
    });
  }

  getConnectionInfo(): BotConnection {
    return GetBotConnectionResponse.parse({
      discord: {
        gatewayConnected: this.gatewayConnected,
        latencyMs: this.gatewayConnected
          ? this.currentUsage?.gatewayLatencyMs ?? null
          : null,
        shards: [...this.shardIds].sort((left, right) => left - right),
        botUsername: this.botUsername,
        connectedAt: this.gatewayConnectedAt?.toISOString() ?? null,
      },
      minecraft: {
        address: "willed-loading.gl.at.ply.gg:22376",
        host: "willed-loading.gl.at.ply.gg",
        port: 22376,
        statusMode: "on-demand",
        statusCommand: "/mcstatus",
        connectionCommand: "/ip",
        note: "Minecraft status is checked only when /mcstatus is run. The dashboard does not probe the game server.",
      },
    });
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.actionQueue.then(action, action);
    this.actionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async startNow(): Promise<ManagedBotStatus> {
    if (this.child && this.child.exitCode === null) {
      return this.getStatus();
    }

    const entry = findBotEntry();
    if (!entry) {
      this.state = "error";
      this.lastError = "The Discord bot entry file could not be found.";
      this.logger.error(
        { cwd: process.cwd() },
        "Cannot find discord-bot/src/index.js",
      );
      return this.getStatus();
    }

    this.state = "starting";
    this.stopping = false;
    this.gatewayConnected = false;
    this.startedAt = new Date();
    this.lastExitCode = null;
    this.lastError = null;

    try {
      const child = spawn(process.execPath, [entry], {
        cwd: resolve(dirname(entry), "../.."),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;

      child.once("spawn", () => {
        if (this.child !== child) return;
        this.state = "running";
        this.logger.info(
          { pid: child.pid },
          "Managed Discord bot process started",
        );
      });

      let stdoutBuffer = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8");
        if (stdoutBuffer.length > 16_000) {
          this.handleBotOutput("stdout", stdoutBuffer.slice(0, 16_000));
          stdoutBuffer = "";
          return;
        }
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) this.handleBotOutput("stdout", line);
      });
      let stderrBuffer = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString("utf8");
        if (stderrBuffer.length > 16_000) {
          this.handleBotOutput("stderr", stderrBuffer.slice(0, 16_000));
          stderrBuffer = "";
          return;
        }
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) this.handleBotOutput("stderr", line);
      });

      child.once("error", (error) => {
        if (this.child !== child) return;
        this.state = "error";
        this.gatewayConnected = false;
        this.lastError = error.message;
        if (child.pid === undefined) {
          this.child = null;
          this.startedAt = null;
        }
        this.logger.error(
          { err: error, pid: child.pid },
          "Managed Discord bot process error",
        );
      });

      child.once("exit", (code, signal) => {
        if (this.child !== child) return;
        if (stdoutBuffer.trim()) {
          this.handleBotOutput("stdout", stdoutBuffer);
        }
        if (stderrBuffer.trim()) {
          this.handleBotOutput("stderr", stderrBuffer);
        }
        this.child = null;
        this.gatewayConnected = false;
        this.gatewayConnectedAt = null;
        this.lastExitCode = code;
        if (this.stopping || code === 0) {
          this.state = "stopped";
          this.lastError = null;
        } else {
          this.state = "error";
          this.lastError = signal
            ? `The bot exited after signal ${signal}.`
            : `The bot process exited with code ${code ?? "unknown"}.`;
        }
        this.startedAt = null;
        this.logger.info(
          { code, signal },
          "Managed Discord bot process exited",
        );
      });
    } catch (error) {
      this.child = null;
      this.state = "error";
      this.gatewayConnected = false;
      this.startedAt = null;
      this.lastError =
        error instanceof Error ? error.message : "Could not start the bot.";
      this.logger.error({ err: error }, "Could not spawn managed bot");
    }

    return this.getStatus();
  }

  private async stopNow(): Promise<ManagedBotStatus> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.child = null;
      this.state = "stopped";
      this.gatewayConnected = false;
      this.startedAt = null;
      return this.getStatus();
    }

    this.stopping = true;
    this.state = "stopping";
    this.gatewayConnected = false;

    await new Promise<void>((resolveStop) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceKillTimer);
        resolveStop();
      };

      child.once("exit", finish);
      const forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
          setTimeout(finish, 250).unref();
        } else {
          finish();
        }
      }, 5_000);

      if (child.exitCode !== null) finish();
      else child.kill("SIGTERM");
    });

    if (this.child === child) {
      this.child = null;
      this.state = "stopped";
      this.gatewayConnected = false;
      this.startedAt = null;
      this.lastError = null;
    }

    return this.getStatus();
  }

  private handleBotOutput(source: "stdout" | "stderr", line: string): void {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;

    if (
      source === "stdout" &&
      trimmedLine.startsWith(PROFILER_PREFIX)
    ) {
      try {
        const rawSample: unknown = JSON.parse(
          trimmedLine.slice(PROFILER_PREFIX.length),
        );
        const validated = GetBotUsageResponse.parse({
          current: rawSample,
          history: [],
          retentionMinutes: USAGE_RETENTION_MINUTES,
        });
        if (validated.current) {
          this.currentUsage = validated.current;
          this.usageHistory.push(validated.current);
          if (this.usageHistory.length > MAX_USAGE_SAMPLES) {
            this.usageHistory.splice(
              0,
              this.usageHistory.length - MAX_USAGE_SAMPLES,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          { err: error },
          "Ignored an invalid profiler sample from the bot",
        );
      }
      return;
    }

    const readyMatch = trimmedLine.match(
      /Discord gateway shard (\d+) is ready/,
    );
    if (readyMatch) {
      this.shardIds.add(Number(readyMatch[1]));
      this.setGatewayConnected(true);
      this.logger.info("Managed Discord bot connected to the gateway");
    }

    const usernameMatch = trimmedLine.match(/Discord bot online as (.+)$/);
    if (usernameMatch) {
      this.botUsername = usernameMatch[1].trim();
      this.setGatewayConnected(true);
    }

    if (
      /Discord gateway shard \d+ is reconnecting/.test(trimmedLine) ||
      /Discord gateway shard \d+ disconnected/.test(trimmedLine)
    ) {
      this.setGatewayConnected(false);
      this.logger.warn("Managed Discord bot gateway connection interrupted");
    }

    const message = sanitizeLogMessage(trimmedLine);
    if (!message) return;
    const lowerCaseMessage = message.toLowerCase();
    const level =
      /error|failed|failure/.test(lowerCaseMessage)
        ? "error"
        : source === "stderr" || /warn|reconnect/.test(lowerCaseMessage)
          ? "warn"
          : "info";
    const entry = GetBotLogsResponse.parse({
      entries: [
        {
          timestamp: new Date().toISOString(),
          source,
          level,
          message,
        },
      ],
    }).entries[0];
    if (entry) {
      this.logs.push(entry);
      if (this.logs.length > MAX_LOG_ENTRIES) {
        this.logs.splice(0, this.logs.length - MAX_LOG_ENTRIES);
      }
    }
  }

  private setGatewayConnected(connected: boolean): void {
    if (connected && !this.gatewayConnected) {
      this.gatewayConnectedAt = new Date();
    } else if (!connected) {
      this.gatewayConnectedAt = null;
    }
    this.gatewayConnected = connected;
  }
}

export const botProcessManager = new BotProcessManager(
  logger,
);
