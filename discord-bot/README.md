# JavaScript Discord Bot

This bot logs in with the `TOKEN` secret and registers two slash commands:

- `/ping` — replies with the bot's current WebSocket latency
- `/hello` — greets the person who used the command
- `/team-create name:<name>` — creates a team role and gives it to you
- `/team-join name:<name>` — gives you an existing team role
- `/team-leave name:<name>` — removes an existing team role from you

## Discord setup

Invite the bot with the `bot` and `applications.commands` scopes. It needs permission to view channels, send messages, and manage roles in the server where it is invited. No privileged gateway intent is required for team commands.

To receive new-member events, enable **Server Members Intent** under **Privileged Gateway Intents** in the Developer Portal. When a new member joins, the bot sends the configured welcome message by DM. If that member has DMs disabled, the bot logs the failure and continues running.

The bot token is stored in Replit Secrets as `TOKEN`; it is never hard-coded in the source.

## Run

```bash
pnpm --filter @workspace/discord-bot start
```