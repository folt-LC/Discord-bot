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
- Shows Java/Bedrock Minecraft status and player counts through `/mcstatus`.
- Lets the team manager create, join, leave, and delete team roles.

## User preferences

- Use JavaScript for the Discord bot.

## Gotchas

- The bot must be invited with the `applications.commands` scope for slash commands to appear.
- Server Members Intent must be enabled for welcome DMs to trigger on new joins.
- Only the configured team manager Discord account can use `/team-delete`.
- `MC_SERVER_IP` is checked every 60 seconds; the current target did not answer the live Java or Bedrock probe.
- Do not print or commit the `TOKEN` value.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
