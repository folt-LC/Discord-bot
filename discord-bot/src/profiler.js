const { availableParallelism } = require("node:os");
const { monitorEventLoopDelay, performance } = require("node:perf_hooks");

const MOD_NAMES = Object.freeze({
  CACHE_PRUNER: "cache-pruner",
  ADAPTIVE_COOLDOWN: "adaptive-cooldown",
});

const DEFAULT_OPTIONS = Object.freeze({
  sampleIntervalMs: 10_000,
  memoryThreshold: 0.85,
  cpuThreshold: 85,
  eventLoopLagThresholdMs: 250,
  messageMaxAgeMs: 15 * 60_000,
});

const BASE_COMMAND_COOLDOWNS_MS = Object.freeze({
  mcstatus: 5_000,
  default: 1_000,
});

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(milliseconds) {
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)}ms`
    : `${(milliseconds / 1_000).toFixed(1)}s`;
}

class PerformanceProfiler {
  constructor(client, options = {}) {
    this.client = client;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.interval = null;
    this.sampling = false;
    this.lastSampleAt = performance.now();
    this.lastCpuUsage = process.cpuUsage();
    this.globalCommandCooldowns = new Map();
    this.cooldownMultiplier = 1;
    this.pressure = { memory: false, cpu: false, eventLoop: false };
    this.mods = {
      [MOD_NAMES.CACHE_PRUNER]: true,
      [MOD_NAMES.ADAPTIVE_COOLDOWN]: true,
    };
    this.snapshot = {
      sampledAt: null,
      cpuPercent: 0,
      memory: {
        heapUsed: 0,
        heapTotal: 0,
        rss: 0,
        heapUtilization: 0,
      },
      eventLoop: { meanMs: 0, maxMs: 0 },
      gatewayLatencyMs: null,
      pressure: { ...this.pressure },
      cooldownMultiplier: 1,
      cache: this.getCacheCounts(),
      mods: { ...this.mods },
    };
  }

  start() {
    if (this.interval) return;

    this.eventLoopDelay.enable();
    this.lastSampleAt = performance.now();
    this.lastCpuUsage = process.cpuUsage();
    this.interval = setInterval(() => {
      this.sample().catch((error) => {
        console.error("Performance profiler sample failed:", error);
      });
    }, this.options.sampleIntervalMs);
    this.sample().catch((error) => {
      console.error("Initial performance profiler sample failed:", error);
    });
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.eventLoopDelay.disable();
  }

  getStatus() {
    return {
      ...this.snapshot,
      memory: { ...this.snapshot.memory },
      eventLoop: { ...this.snapshot.eventLoop },
      pressure: { ...this.snapshot.pressure },
      mods: { ...this.snapshot.mods },
      thresholds: {
        cpuPercent: this.options.cpuThreshold,
        heapUtilization: this.options.memoryThreshold,
        eventLoopLagMs: this.options.eventLoopLagThresholdMs,
      },
    };
  }

  toggleMod(name) {
    if (!Object.values(MOD_NAMES).includes(name)) return null;

    this.mods[name] = !this.mods[name];
    if (name === MOD_NAMES.ADAPTIVE_COOLDOWN && !this.mods[name]) {
      this.cooldownMultiplier = 1;
      this.globalCommandCooldowns.clear();
    }

    return { name, enabled: this.mods[name] };
  }

  checkCommandCooldown(commandName) {
    if (
      !this.mods[MOD_NAMES.ADAPTIVE_COOLDOWN] ||
      this.cooldownMultiplier <= 1 ||
      commandName === "profiler"
    ) {
      return 0;
    }

    const now = Date.now();
    const baseCooldown =
      BASE_COMMAND_COOLDOWNS_MS[commandName] ||
      BASE_COMMAND_COOLDOWNS_MS.default;
    const cooldownMs = baseCooldown * this.cooldownMultiplier;
    const lastUsedAt = this.globalCommandCooldowns.get(commandName) || 0;
    const remainingMs = cooldownMs - (now - lastUsedAt);

    if (remainingMs > 0) return remainingMs;

    this.globalCommandCooldowns.set(commandName, now);
    this.pruneCooldownEntries(now);
    return 0;
  }

  async sample() {
    if (this.sampling) return;
    this.sampling = true;

    try {
      const now = performance.now();
      const elapsedMicros = Math.max((now - this.lastSampleAt) * 1_000, 1);
      const cpuDelta = process.cpuUsage(this.lastCpuUsage);
      const cpuCoreCount = Math.max(availableParallelism(), 1);
      const cpuPercent =
        ((cpuDelta.user + cpuDelta.system) / elapsedMicros / cpuCoreCount) *
        100;
      const memory = process.memoryUsage();
      const eventLoop = {
        meanMs: Number.isFinite(this.eventLoopDelay.mean)
          ? this.eventLoopDelay.mean / 1e6
          : 0,
        maxMs: Number.isFinite(this.eventLoopDelay.max)
          ? this.eventLoopDelay.max / 1e6
          : 0,
      };

      this.lastSampleAt = now;
      this.lastCpuUsage = process.cpuUsage();
      this.eventLoopDelay.reset();

      this.pressure = {
        memory:
          memory.heapTotal > 0 &&
          memory.heapUsed / memory.heapTotal >= this.options.memoryThreshold,
        cpu: cpuPercent >= this.options.cpuThreshold,
        eventLoop: eventLoop.maxMs >= this.options.eventLoopLagThresholdMs,
      };

      const overload = this.pressure.cpu || this.pressure.eventLoop;
      this.cooldownMultiplier =
        this.mods[MOD_NAMES.ADAPTIVE_COOLDOWN] && overload
          ? this.pressure.eventLoop
            ? 4
            : 2
          : 1;

      this.snapshot = {
        sampledAt: new Date().toISOString(),
        cpuPercent,
        memory: {
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          rss: memory.rss,
          heapUtilization:
            memory.heapTotal > 0 ? memory.heapUsed / memory.heapTotal : 0,
        },
        eventLoop,
        gatewayLatencyMs: Number.isFinite(this.client.ws?.ping)
          ? this.client.ws.ping
          : null,
        pressure: { ...this.pressure },
        cooldownMultiplier: this.cooldownMultiplier,
        cache: this.getCacheCounts(),
        mods: { ...this.mods },
      };

      if (
        this.mods[MOD_NAMES.CACHE_PRUNER] &&
        this.pressure.memory
      ) {
        await this.pruneCaches();
        this.snapshot.cache = this.getCacheCounts();
      }
    } finally {
      this.sampling = false;
    }
  }

  getCacheCounts() {
    let messages = 0;
    for (const channel of this.client.channels.cache.values()) {
      messages += channel.messages?.cache?.size || 0;
    }

    let guildMembers = 0;
    for (const guild of this.client.guilds.cache.values()) {
      guildMembers += guild.members.cache.size;
    }

    return {
      guilds: this.client.guilds.cache.size,
      guildMembers,
      users: this.client.users.cache.size,
      channels: this.client.channels.cache.size,
      messages,
    };
  }

  async pruneCaches() {
    const cutoff = Date.now() - this.options.messageMaxAgeMs;

    for (const channel of this.client.channels.cache.values()) {
      const messages = channel.messages?.cache;
      if (messages) {
        await this.sweepCollection(
          messages,
          (message) =>
            message.createdTimestamp > 0 &&
            message.createdTimestamp < cutoff,
        );
      }
    }

    const botUserId = this.client.user?.id;
    for (const guild of this.client.guilds.cache.values()) {
      await this.sweepCollection(
        guild.members.cache,
        (member) => member.id !== botUserId && member.id !== guild.ownerId,
      );

      // Clear nonessential per-guild caches; retain guilds and roles used by commands.
      guild.presences?.cache?.clear();
      guild.voiceStates?.cache?.clear();
    }

    const cachedMemberIds = new Set();
    for (const guild of this.client.guilds.cache.values()) {
      for (const memberId of guild.members.cache.keys()) {
        cachedMemberIds.add(memberId);
      }
    }

    await this.sweepCollection(
      this.client.users.cache,
      (user) => user.id !== botUserId && !cachedMemberIds.has(user.id),
    );
  }

  async sweepCollection(collection, shouldDelete) {
    let processed = 0;
    for (const [key, value] of collection) {
      if (shouldDelete(value, key)) collection.delete(key);
      processed += 1;
      if (processed % 100 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }

  pruneCooldownEntries(now) {
    if (this.globalCommandCooldowns.size < 100) return;
    for (const [commandName, timestamp] of this.globalCommandCooldowns) {
      if (now - timestamp > 60_000) {
        this.globalCommandCooldowns.delete(commandName);
      }
    }
  }
}

module.exports = {
  MOD_NAMES,
  PerformanceProfiler,
  formatDuration,
  formatMegabytes,
};
