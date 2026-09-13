# JavaScript Discord Bot

This bot logs in with the `TOKEN` secret and registers two slash commands:

- `/ping` — replies with the bot's current WebSocket latency
- `/hello` — greets the person who used the command

## Discord setup

Invite the bot with the `bot` and `applications.commands` scopes. It needs permission to view channels and send messages in the server where it is invited. No privileged gateway intent is required.

The bot token is stored in Replit Secrets as `TOKEN`; it is never hard-coded in the source.

## Run

```bash
pnpm --filter @workspace/discord-bot start
```