# JavaScript Discord Bot

A small Discord bot that stays online and responds to `/ping` and `/hello`.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/discord-bot start` — run the Discord bot
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `discord-bot/src/index.js` — Discord client, login, commands, and shutdown handling
- `discord-bot/README.md` — Discord Developer Portal setup and command reference
- `TOKEN` secret — bot token, managed through Replit Secrets

## Architecture decisions

- The bot uses Discord Gateway events through `discord.js`.
- The token is read only from the `TOKEN` environment secret.
- The bot runs as a console workflow rather than a web server.

## Product

- Stays connected to Discord while the workflow is running.
- Responds to `!ping` with latency.
- Responds to `!hello` with a greeting.
- Shows on-demand Java/Bedrock Minecraft status and player counts through `/mcstatus`.
- Provides the always-available Mendive SMP address through `/ip`.
- Lets members create, join, and leave team roles.
- Lets the configured team manager delete team roles through `/team-delete`.

## User preferences

- Use JavaScript for the Discord bot.

## Gotchas

- The bot must be invited with the `applications.commands` scope for slash commands to appear.
- Server Members Intent must be enabled for welcome DMs to trigger on new joins.
- `/mcstatus` performs a fresh server check only when a user runs the command.
- Only Discord user ID `1409996406097186866` can use `/team-delete`.
- Do not print or commit the `TOKEN` value.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
