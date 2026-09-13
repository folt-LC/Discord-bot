const {
  Client,
  Events,
  GatewayIntentBits,
} = require("discord.js");

const token = process.env.TOKEN;

if (!token) {
  throw new Error(
    "TOKEN is not set. Add your Discord bot token as the TOKEN secret.",
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Discord bot online as ${readyClient.user.tag}`);
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