const {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require("discord.js");

const token = process.env.TOKEN;
const teamManagerUserId = "1409996406097186866";
const welcomeMessage =
  "Hello and welcome to the Mendive SMP! We are thrilled to have you join our community! Grab your gear, build something epic, and most importantly, have fun surviving out there.";

if (!token) {
  throw new Error(
    "TOKEN is not set. Add your Discord bot token as the TOKEN secret.",
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

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

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Discord bot online as ${readyClient.user.tag}`);
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
    ])
    .then(() => {
      console.log(
        "Registered /ping, /hello, /team-create, /team-join, /team-leave, and /team-delete",
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

  if (interaction.commandName === "ping") {
    await interaction.reply(`Pong! ${client.ws.ping}ms`);
  }

  if (interaction.commandName === "hello") {
    await interaction.reply(`Hello, ${interaction.user}!`);
  }

  if (
    !["team-create", "team-join", "team-leave", "team-delete"].includes(
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
    interaction.commandName === "team-delete" &&
    interaction.user.id !== teamManagerUserId
  ) {
    await interaction.reply(
      "🚫  Only the team manager can delete teams.",
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
    await member.send(welcomeMessage);
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

process.on("SIGTERM", () => {
  client.destroy();
  process.exit(0);
});

process.on("SIGINT", () => {
  client.destroy();
  process.exit(0);
});

client.login(token).catch((error) => {
  console.error("Discord login failed. Check the TOKEN secret and bot settings.");
  console.error(error);
  process.exit(1);
});