import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Readable } from "node:stream";
import type { Logger } from "pino";
import { logger } from "./logger";

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

    if (!process.env.TOKEN) {
      this.state = "error";
      this.lastError = "The bot TOKEN secret is not configured.";
      this.logger.error("Cannot start the managed bot: TOKEN is missing");
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
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) this.handleBotOutput(line);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const output = chunk.toString("utf8").trim();
        if (output) {
          this.logger.warn(
            { pid: child.pid, output: output.slice(0, 1_000) },
            "Managed Discord bot stderr",
          );
        }
      });

      child.once("error", (error) => {
        if (this.child !== child) return;
        this.state = "error";
        this.gatewayConnected = false;
        this.lastError = error.message;
        this.logger.error(
          { err: error, pid: child.pid },
          "Managed Discord bot process error",
        );
      });

      child.once("exit", (code, signal) => {
        if (this.child !== child) return;
        this.child = null;
        this.gatewayConnected = false;
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

  private handleBotOutput(line: string): void {
    if (!line) return;

    if (
      line.includes("Discord bot online as") ||
      /Discord gateway shard \d+ is ready/.test(line)
    ) {
      this.gatewayConnected = true;
      this.logger.info("Managed Discord bot connected to the gateway");
      return;
    }

    if (
      /Discord gateway shard \d+ is reconnecting/.test(line) ||
      /Discord gateway shard \d+ disconnected/.test(line)
    ) {
      this.gatewayConnected = false;
      this.logger.warn("Managed Discord bot gateway connection interrupted");
    }
  }
}

export const botProcessManager = new BotProcessManager(
  logger,
);
