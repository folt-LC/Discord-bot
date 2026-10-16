---
name: Bot process ownership
description: Keep bot startup and lifecycle under the dashboard-managed API service to prevent duplicate Discord sessions.
---

The API server's bot manager is the sole owner of the Discord bot process. Keep startup, restart, and stop behavior under that service and its dashboard controls; do not add a separate bot workflow to the project run configuration.

**Why:** Running a standalone bot workflow alongside the API-managed process creates parallel clients for the same bot and can duplicate event handling, such as welcome messages.

**How to apply:** Before changing bot lifecycle workflows, check whether the API service already starts and manages the bot. Preserve a single process owner.
