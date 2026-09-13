const {
  Client,
  Events,
  GatewayIntentBits,
} = require("discord.js");

const token = process.env.TOKEN;
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
    ])
    .then(() => {
      console.log("Registered /ping and /hello");
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