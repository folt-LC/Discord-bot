const dgram = require("node:dgram");
const net = require("node:net");
const minecraftStatusPinger = require("minecraftstatuspinger");
const {
  MOD_NAMES,
  PerformanceProfiler,
  formatDuration,
  formatMegabytes,
} = require("./profiler");
const {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require("discord.js");

const token = process.env.TOKEN;
const minecraftServerAddress = process.env.MC_SERVER_IP?.trim();
const teamManagerUserId = "1409996406097186866";
const welcomeMessage =
  "Hello and welcome to the Mendive SMP! We are thrilled to have you join our community! Grab your gear, build something epic, and most importantly, have fun surviving out there.";
const bedrockMagic = Buffer.from([
  0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe, 0xfd, 0xfd, 0xfd, 0xfd,
  0x12, 0x34, 0x56, 0x78,
]);

if (!token) {
  throw new Error(
    "TOKEN is not set. Add your Discord bot token as the TOKEN secret.",
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});
const profiler = new PerformanceProfiler(client, {
  onSample: (status) => {
    const dashboardSnapshot = {
      ...status,
      mods: {
        cachePruner: status.mods[MOD_NAMES.CACHE_PRUNER],
        adaptiveCooldown: status.mods[MOD_NAMES.ADAPTIVE_COOLDOWN],
      },
    };
    process.stdout.write(
      `MENDIVE_PROFILER_SNAPSHOT ${JSON.stringify(dashboardSnapshot)}\n`,
    );
  },
});

function setBotOnlinePresence() {
  if (!client.user) {
    return;
  }

  client.user.setPresence({
    status: "online",
  });
}

let minecraftRefreshPromise = null;

function parseServerAddress(address, defaultPort) {
  if (address.startsWith("[")) {
    const closingBracket = address.indexOf("]");
    if (closingBracket === -1) {
      throw new Error("Invalid bracketed server address");
    }
    const host = address.slice(1, closingBracket);
    const portText = address.slice(closingBracket + 1).replace(/^:/, "");
    return {
      host,
      port: portText ? Number.parseInt(portText, 10) : defaultPort,
      hasExplicitPort: Boolean(portText),
    };
  }

  const colonCount = (address.match(/:/g) || []).length;
  const lastColon = address.lastIndexOf(":");
  const hasExplicitPort = colonCount === 1 && lastColon > 0;
  const host = hasExplicitPort ? address.slice(0, lastColon) : address;
  const port = hasExplicitPort
    ? Number.parseInt(address.slice(lastColon + 1), 10)
    : defaultPort;

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid Minecraft server address");
  }

  return { host, port, hasExplicitPort };
}

function flattenMotd(value) {
  if (typeof value === "string") {
    return value.replace(/§./g, "").replace(/\s+/g, " ").trim();
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  return [
    typeof value.text === "string" ? value.text : "",
    ...(Array.isArray(value.extra)
      ? value.extra.map((part) => flattenMotd(part))
      : []),
  ]
    .join("")
    .replace(/§./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePlayerNames(players) {
  if (!Array.isArray(players)) {
    return [];
  }

  return players
    .map((player) =>
      typeof player === "string" ? player : player?.name,
    )
    .filter((name) => typeof name === "string" && name.trim())
    .map((name) => name.trim());
}

function createOfflineMinecraftStatus(host, port, error) {
  return {
    online: false,
    edition: "Not available",
    host,
    port,
    version: "Not available",
    motd: "",
    onlinePlayers: 0,
    maxPlayers: 0,
    players: [],
    latency: null,
    checkedAt: Date.now(),
    error,
  };
}

async function queryJavaMinecraftServer(host, port) {
  const response = await minecraftStatusPinger.lookup({
    host,
    port,
    timeout: 5_000,
    ping: true,
    SRVLookup: port === 25565,
  });
  const status = response.status || {};
  const players = status.players || {};

  return {
    online: true,
    edition: "Java",
    host,
    port,
    version: status.version?.name || "Unknown",
    motd: flattenMotd(status.description || status.motd),
    onlinePlayers: Number(players.online) || 0,
    maxPlayers: Number(players.max) || 0,
    players: normalizePlayerNames(players.sample || players.list),
    latency: Number.isFinite(response.latency) ? response.latency : null,
    checkedAt: Date.now(),
    error: "",
  };
}

function queryBedrockMinecraftServer(host, port) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(net.isIP(host) === 6 ? "udp6" : "udp4");
    const request = Buffer.alloc(1 + 8 + bedrockMagic.length);
    let settled = false;

    request[0] = 0x01;
    request.writeBigInt64BE(BigInt(Date.now()), 1);
    bedrockMagic.copy(request, 9);

    const finish = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.close();
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    const timeout = setTimeout(
      () => finish(new Error("Bedrock status request timed out")),
      5_000,
    );

    socket.once("error", (error) => finish(error));
    socket.on("message", (message) => {
      if (message.length < 35 || message[0] !== 0x1c) {
        return;
      }

      const advertisementLength = message.readUInt16BE(33);
      const advertisement = message
        .subarray(35, 35 + advertisementLength)
        .toString("utf8");
      const fields = advertisement.split(";");

      finish(null, {
        online: true,
        edition: "Bedrock",
        host,
        port,
        version: fields[3] || "Unknown",
        motd: fields[1] || "",
        onlinePlayers: Number.parseInt(fields[4], 10) || 0,
        maxPlayers: Number.parseInt(fields[5], 10) || 0,
        players: [],
        latency: null,
        checkedAt: Date.now(),
        error: "",
      });
    });

    socket.send(request, port, host, (error) => {
      if (error) {
        finish(error);
      }
    });
  });
}

function logMinecraftStatus(status) {
  console.log(
    `Minecraft status: ${status.online ? "online" : "offline"} (${status.edition}) ${status.onlinePlayers}/${status.maxPlayers} players`,
  );
}

async function checkMinecraftStatus() {
  if (minecraftRefreshPromise) {
    return minecraftRefreshPromise;
  }

  minecraftRefreshPromise = (async () => {
    if (!minecraftServerAddress) {
      const status = createOfflineMinecraftStatus(
        "Not configured",
        null,
        "MC_SERVER_IP is not configured.",
      );
      logMinecraftStatus(status);
      return status;
    }

    let javaAddress;
    let bedrockAddress;
    try {
      javaAddress = parseServerAddress(minecraftServerAddress, 25565);
      bedrockAddress = parseServerAddress(minecraftServerAddress, 19132);
    } catch {
      const status = createOfflineMinecraftStatus(
        minecraftServerAddress,
        null,
        "MC_SERVER_IP is not a valid host or host:port address.",
      );
      logMinecraftStatus(status);
      return status;
    }

    try {
      const status = await queryJavaMinecraftServer(
        javaAddress.host,
        javaAddress.port,
      );
      logMinecraftStatus(status);
      return status;
    } catch {
      try {
        const status = await queryBedrockMinecraftServer(
          bedrockAddress.host,
          bedrockAddress.port,
        );
        logMinecraftStatus(status);
        return status;
      } catch {
        const status = createOfflineMinecraftStatus(
          javaAddress.host,
          javaAddress.port,
          "The server is offline or did not respond to Java or Bedrock status checks.",
        );
        logMinecraftStatus(status);
        return status;
      }
    }
  })().finally(() => {
    minecraftRefreshPromise = null;
  });

  return minecraftRefreshPromise;
}

function shortenEmbedField(value, maxLength = 1024) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function buildMinecraftStatusEmbed(status) {
  if (!status.online) {
    return new EmbedBuilder()
      .setTitle("Minecraft Server Status")
      .setColor(0xed4245)
      .addFields(
        {
          name: "Status",
          value: "🔴 Server Status: Offline / Booting up",
        },
        {
          name: "Players",
          value: "0/0 players",
          inline: true,
        },
        {
          name: "Connection note",
          value: "Launch the start file and playit.gg to connect.",
        },
      )
      .setFooter({
        text: "Use /ip to copy the connection address",
      })
      .setTimestamp(status.checkedAt || Date.now());
  }

  const playerList = status.players.length
    ? status.players.join("\n")
    : status.edition === "Bedrock"
      ? "Player names are not included in the Bedrock status response."
      : "No player list was advertised by the server.";

  const embed = new EmbedBuilder()
    .setTitle("Minecraft Server Status")
    .setColor(status.online ? 0x57f287 : 0xed4245)
    .addFields(
      {
        name: "Status",
        value: "🟢 Server Status: Online",
        inline: true,
      },
      {
        name: "Players",
        value: `${status.onlinePlayers}/${status.maxPlayers}`,
        inline: true,
      },
      {
        name: "Edition",
        value: status.edition,
        inline: true,
      },
      {
        name: "Version",
        value: status.version,
        inline: true,
      },
      {
        name: "Online players",
        value: shortenEmbedField(playerList),
      },
    )
    .setFooter({
      text: `${status.host}${status.port ? `:${status.port}` : ""}`,
    })
    .setTimestamp(status.checkedAt || Date.now());

  if (status.motd) {
    embed.setDescription(status.motd);
  }
  if (status.latency !== null) {
    embed.addFields({
      name: "Latency",
      value: `${status.latency}ms`,
      inline: true,
    });
  }

  return embed;
}

function findRoleByName(guild, teamName) {
  const normalizedName = teamName.toLowerCase();
  return guild.roles.cache.find(
    (role) => role.name.toLowerCase() === normalizedName,
  );
}

function canManageRoles(guild) {
  const botMember = guild.members.me;
  return Boolean(
    botMember?.permissions.has(PermissionFlagsBits.ManageRoles),
  );
}

function canManageRole(guild, role) {
  const botMember = guild.members.me;
  return Boolean(
    botMember &&
      !role.managed &&
      botMember.roles.highest.position > role.position,
  );
}

function getTeamName(interaction) {
  return interaction.options.getString("name", true).trim();
}

function isValidTeamName(teamName) {
  return (
    teamName.length > 0 &&
    teamName.length <= 100 &&
    teamName.toLowerCase() !== "@everyone"
  );
}

function isProfilerAdmin(interaction) {
  return (
    interaction.user.id === teamManagerUserId ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  );
}

function buildProfilerStatusEmbed(status) {
  const hasPressure = Object.values(status.pressure).some(Boolean);
  const modValue = (name) =>
    status.mods[name] ? "🟢 Enabled" : "⚪ Disabled";
  const pressureValue = (name) =>
    status.pressure[name] ? "⚠️ High" : "✅ Normal";

  return new EmbedBuilder()
    .setTitle("Bot Performance Profiler")
    .setColor(hasPressure ? 0xfee75c : 0x57f287)
    .addFields(
      {
        name: "CPU",
        value: `${status.cpuPercent.toFixed(1)}% · ${pressureValue("cpu")}`,
        inline: true,
      },
      {
        name: "Heap used / total",
        value: `${formatMegabytes(status.memory.heapUsed)} / ${formatMegabytes(status.memory.heapTotal)} (${(status.memory.heapUtilization * 100).toFixed(1)}%) · ${pressureValue("memory")}`,
        inline: true,
      },
      {
        name: "RSS",
        value: formatMegabytes(status.memory.rss),
        inline: true,
      },
      {
        name: "Event loop lag",
        value: `${formatDuration(status.eventLoop.maxMs)} max / ${formatDuration(status.eventLoop.meanMs)} avg · ${pressureValue("eventLoop")}`,
        inline: true,
      },
      {
        name: "Gateway latency",
        value:
          status.gatewayLatencyMs === null
            ? "Unavailable"
            : `${status.gatewayLatencyMs}ms`,
        inline: true,
      },
      {
        name: "Adaptive cooldown",
        value: `${modValue(MOD_NAMES.ADAPTIVE_COOLDOWN)} · ${status.cooldownMultiplier}x`,
        inline: true,
      },
      {
        name: "Cache pruner",
        value: modValue(MOD_NAMES.CACHE_PRUNER),
        inline: true,
      },
      {
        name: "Cache sizes",
        value: `Guilds: ${status.cache.guilds}\nMembers: ${status.cache.guildMembers}\nUsers: ${status.cache.users}\nChannels: ${status.cache.channels}\nMessages: ${status.cache.messages}`,
        inline: true,
      },
    )
    .setFooter({
      text: status.sampledAt
        ? `Sampled ${status.sampledAt}`
        : "Waiting for first sample",
    });
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Discord bot online as ${readyClient.user.tag}`);
  setBotOnlinePresence();
  // Start the asynchronous profiler after the Discord gateway is ready.
  profiler.start();
  const serverNames = readyClient.guilds.cache.map((guild) => guild.name);
  console.log(
    `Connected to ${serverNames.length ? serverNames.join(", ") : "no servers yet"}`,
  );
  readyClient.application.commands
    .set([
      {
        name: "ping",
        description: "Check the bot's connection latency",
      },
      {
        name: "hello",
        description: "Get a greeting from the bot",
      },
      {
        name: "mcstatus",
        description: "Show the Minecraft server status",
      },
      {
        name: "ip",
        description: "Show the Mendive SMP connection address",
      },
      {
        name: "team-create",
        description: "Create a team role and join it",
        options: [
          {
            type: 3,
            name: "name",
            description: "The name of the team",
            required: true,
          },
        ],
      },
      {
        name: "team-join",
        description: "Join an existing team",
        options: [
          {
            type: 3,
            name: "name",
            description: "The name of the team",
            required: true,
          },
        ],
      },
      {
        name: "team-leave",
        description: "Leave a team",
        options: [
          {
            type: 3,
            name: "name",
            description: "The name of the team",
            required: true,
          },
        ],
      },
      {
        name: "team-delete",
        description: "Delete a team role (team manager only)",
        options: [
          {
            type: 3,
            name: "name",
            description: "The name of the team",
            required: true,
          },
        ],
      },
      {
        name: "team-force",
        description: "Force a member onto an existing team (team manager only)",
        options: [
          {
            type: 3,
            name: "name",
            description: "The name of the existing team",
            required: true,
          },
          {
            type: 6,
            name: "member",
            description: "The member to add to the team",
            required: true,
          },
        ],
      },
      {
        name: "profiler",
        description: "View and manage bot performance monitoring",
        options: [
          {
            type: 1,
            name: "status",
            description: "Show the current performance dashboard",
          },
          {
            type: 1,
            name: "toggle",
            description: "Enable or disable a performance optimization",
            options: [
              {
                type: 3,
                name: "mod_name",
                description: "The optimization to toggle",
                required: true,
                choices: [
                  { name: "Cache Pruner", value: MOD_NAMES.CACHE_PRUNER },
                  {
                    name: "Adaptive Cooldown",
                    value: MOD_NAMES.ADAPTIVE_COOLDOWN,
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
    .then(() => {
      console.log(
        "Registered /ping, /hello, /mcstatus, /ip, /team-create, /team-join, /team-leave, /team-delete, /team-force, and /profiler",
      );
    })
    .catch((error) => {
      console.error("Could not register slash commands:", error);
    });

});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === "profiler") {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "🏠  Profiler commands can only be used inside a server.",
        ephemeral: true,
      });
      return;
    }

    if (!isProfilerAdmin(interaction)) {
      await interaction.reply({
        content: "🚫  Only server administrators can use the profiler.",
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "status") {
      await interaction.reply({
        embeds: [buildProfilerStatusEmbed(profiler.getStatus())],
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "toggle") {
      const result = profiler.toggleMod(
        interaction.options.getString("mod_name", true),
      );
      await interaction.reply({
        content: `✅  **${result.name}** is now ${result.enabled ? "enabled" : "disabled"}.`,
        ephemeral: true,
      });
      return;
    }
  }

  const cooldownRemaining = profiler.checkCommandCooldown(
    interaction.commandName,
  );
  if (cooldownRemaining > 0) {
    await interaction.reply({
      content: `⏳  The bot is under load. Try again in ${(cooldownRemaining / 1_000).toFixed(1)} seconds.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "ping") {
    await interaction.reply(`Pong! ${client.ws.ping}ms`);
    return;
  }

  if (interaction.commandName === "hello") {
    await interaction.reply(`Hello, ${interaction.user}!`);
    return;
  }

  if (interaction.commandName === "ip") {
    await interaction.reply(
      "🎮 Connection Info: willed-loading.gl.at.ply.gg:22376",
    );
    return;
  }

  if (interaction.commandName === "mcstatus") {
    await interaction.deferReply();
    try {
      const status = await checkMinecraftStatus();
      await interaction.editReply({
        embeds: [buildMinecraftStatusEmbed(status)],
      });
    } catch (error) {
      console.error("Could not build the Minecraft status response:", error);
      await interaction.editReply(
        "❌  I couldn't check the Minecraft server right now.",
      );
    }
    return;
  }

  if (
    ![
      "team-create",
      "team-join",
      "team-leave",
      "team-delete",
      "team-force",
    ].includes(
      interaction.commandName,
    )
  ) {
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.reply(
      "🏠  Team commands can only be used inside a server.",
    );
    return;
  }

  if (
    ["team-delete", "team-force"].includes(interaction.commandName) &&
    interaction.user.id !== teamManagerUserId
  ) {
    await interaction.reply(
      "🚫  Only the team manager can use this command.",
    );
    return;
  }

  const teamName = getTeamName(interaction);
  if (!isValidTeamName(teamName)) {
    await interaction.reply(
      "⚠️  Team names must be between 1 and 100 characters.",
    );
    return;
  }

  if (!canManageRoles(interaction.guild)) {
    await interaction.reply(
      "🔒  I need the Manage Roles permission to manage teams.",
    );
    return;
  }

  const existingRole = findRoleByName(interaction.guild, teamName);

  if (existingRole?.managed) {
    await interaction.reply(
      "⚠️  That name belongs to a managed Discord role and cannot be used as a team.",
    );
    return;
  }

  if (interaction.commandName === "team-delete") {
    if (!existingRole || existingRole.id === interaction.guild.id) {
      await interaction.reply(
        `🔎  I couldn't find a deletable team named **${teamName}**.`,
      );
      return;
    }

    if (!canManageRole(interaction.guild, existingRole)) {
      await interaction.reply(
        "❌  I can't delete that team role. Move my highest role above it in Server Settings.",
      );
      return;
    }

    try {
      await existingRole.delete(`Team deleted by ${interaction.user.tag}`);
      await interaction.reply(`✅  Team **${teamName}** was deleted.`);
    } catch (error) {
      console.error(`Could not delete team ${teamName}:`, error);
      await interaction.reply(
        "❌  I couldn't delete that team. Check my Manage Roles permission and role order.",
      );
    }
    return;
  }

  if (interaction.commandName === "team-force") {
    if (!existingRole) {
      await interaction.reply(
        `🔎  I couldn't find an existing team named **${teamName}**.`,
      );
      return;
    }

    if (!canManageRole(interaction.guild, existingRole)) {
      await interaction.reply(
        "❌  I can't manage that team role. Move my highest role above it in Server Settings.",
      );
      return;
    }

    const targetUser = interaction.options.getUser("member", true);
    try {
      const targetMember = await interaction.guild.members.fetch(targetUser.id);
      const alreadyInTeam = targetMember.roles.cache.has(existingRole.id);

      if (alreadyInTeam) {
        await interaction.reply(
          `ℹ️  ${targetUser} is already on team **${existingRole.name}**.`,
        );
        return;
      }

      await targetMember.roles.add(
        existingRole,
        `Team manager added ${targetUser.tag} to the team`,
      );
      await interaction.reply(
        `✅  ${targetUser} was added to team **${existingRole.name}**.`,
      );
    } catch (error) {
      console.error(
        `Could not force ${targetUser.tag} onto team ${existingRole.name}:`,
        error,
      );
      await interaction.reply(
        "❌  I couldn't add that member. Check my Manage Roles permission and role order.",
      );
    }
    return;
  }

  if (interaction.commandName === "team-create") {
    if (existingRole) {
      await interaction.reply(
        `⚠️  A team named **${existingRole.name}** already exists. Use \`/team-join\` to join it.`,
      );
      return;
    }

    let teamRole;
    try {
      teamRole = await interaction.guild.roles.create({
        name: teamName,
        reason: `Team created by ${interaction.user.tag}`,
      });
      const member = await interaction.guild.members.fetch(
        interaction.user.id,
      );
      await member.roles.add(teamRole, "Team creator joined their new team");
      await interaction.reply(
        `✅  Team **${teamRole.name}** created.\n👤  You have been added to the team.`,
      );
    } catch (error) {
      if (teamRole) {
        await teamRole.delete("Cleaning up a team that could not be assigned").catch(
          () => {},
        );
      }
      console.error(`Could not create team ${teamName}:`, error);
      await interaction.reply(
        "❌  I couldn't create that team. Make sure my highest role is above the team roles.",
      );
    }
    return;
  }

  if (!existingRole) {
    await interaction.reply(
      `🔎  I couldn't find a team named **${teamName}**.`,
    );
    return;
  }

  if (!canManageRole(interaction.guild, existingRole)) {
    await interaction.reply(
      "❌  I can't manage that team role. Move my highest role above it in Server Settings.",
    );
    return;
  }

  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const alreadyInTeam = member.roles.cache.has(existingRole.id);

    if (interaction.commandName === "team-join") {
      if (alreadyInTeam) {
        await interaction.reply(
          `ℹ️  You are already on team **${existingRole.name}**.`,
        );
        return;
      }
      await member.roles.add(existingRole, "Member joined a team");
      await interaction.reply(
        `✅  You joined team **${existingRole.name}**.`,
      );
      return;
    }

    if (!alreadyInTeam) {
      await interaction.reply(
        `ℹ️  You are not currently on team **${existingRole.name}**.`,
      );
      return;
    }

    await member.roles.remove(existingRole, "Member left a team");
    await interaction.reply(`✅  You left team **${existingRole.name}**.`);
  } catch (error) {
    console.error(
      `Could not update team ${existingRole.name} for ${interaction.user.tag}:`,
      error,
    );
    await interaction.reply(
      "❌  I couldn't update your team membership. Please check my Manage Roles permission and role order.",
    );
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("🎉 Welcome to the Mendive SMP!")
      .setDescription(welcomeMessage)
      .addFields({
        name: "Your next adventure",
        value:
          "Grab your gear, build something epic, and have fun surviving out there.",
      })
      .setFooter({ text: "Mendive SMP" });

    await member.send({ embeds: [welcomeEmbed] });
    console.log(`Sent a welcome DM to ${member.user.tag}`);
  } catch (error) {
    console.error(
      `Could not send a welcome DM to ${member.user.tag}. Their DMs may be disabled.`,
      error,
    );
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

client.on(Events.ShardReady, (shardId) => {
  console.log(`Discord gateway shard ${shardId} is ready`);
  setBotOnlinePresence();
});

client.on(Events.ShardReconnecting, (shardId) => {
  console.warn(`Discord gateway shard ${shardId} is reconnecting`);
});

client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
  console.error(
    `Discord gateway shard ${shardId} disconnected (code ${closeEvent.code}).`,
  );
});

client.on(Events.ShardError, (error, shardId) => {
  console.error(`Discord gateway shard ${shardId} error:`, error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled bot promise rejection:", error);
});

process.on("SIGTERM", () => {
  profiler.stop();
  client.destroy();
  process.exit(0);
});

process.on("SIGINT", () => {
  profiler.stop();
  client.destroy();
  process.exit(0);
});

client.login(token).catch((error) => {
  console.error("Discord login failed. Check the TOKEN secret and bot settings.");
  console.error(error);
  process.exit(1);
});