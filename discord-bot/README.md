# JavaScript Discord Bot

This bot logs in with the `TOKEN` secret and registers these slash commands:

- `/ping` — replies with the bot's current WebSocket latency
- `/hello` — greets the person who used the command
- `/mcstatus` — checks the Minecraft server on demand and shows its status, player count, and advertised player list
- `/ip` — shows `willed-loading.gl.at.ply.gg:22376` so players can connect even while the server is offline
- `/team-create name:<name>` — creates a team role and gives it to you
- `/team-join name:<name>` — gives you an existing team role
- `/team-leave name:<name>` — removes an existing team role from you
- `/team-delete name:<name>` — deletes a team role; restricted to the team manager

## Discord setup

Invite the bot with the `bot` and `applications.commands` scopes. It needs permission to view channels, send messages, and manage roles in the server where it is invited. No privileged gateway intent is required for team commands.

To receive new-member events, enable **Server Members Intent** under **Privileged Gateway Intents** in the Developer Portal. When a new member joins, the bot sends the configured welcome message by DM. If that member has DMs disabled, the bot logs the failure and continues running.

The `MC_SERVER_IP` shared environment variable stores the Minecraft server host or `host:port`. `/mcstatus` checks Java Edition first, then falls back to the Bedrock UDP status protocol only when the command is run. When the server is offline, the embed shows the booting-up message and connection instructions. Java servers can advertise a player sample; Bedrock status pings provide the count but not player names.

The bot token is stored in Replit Secrets as `TOKEN`; it is never hard-coded in the source.

## Run

```bash
pnpm --filter @workspace/discord-bot start
```