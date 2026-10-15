import app from "./app";
import { logger } from "./lib/logger";
import { botProcessManager } from "./lib/bot-manager";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void botProcessManager
    .start()
    .then((status) => logger.info({ state: status.state }, "Managed bot startup requested"))
    .catch((error: unknown) =>
      logger.error({ err: error }, "Could not start the managed bot"),
    );
});

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down API server and managed bot");
  server.close();
  void botProcessManager
    .stop()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error({ err: error }, "Failed to stop managed bot cleanly");
      process.exit(1);
    });
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
