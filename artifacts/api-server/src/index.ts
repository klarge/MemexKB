import app from "./app";
import { logger } from "./lib/logger";
import { runSeed } from "./lib/seed";

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

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Seeding is opt-in: only runs when RUN_SEED=true is explicitly set.
  // In production, SEED_ADMIN_EMAIL and a strong SEED_ADMIN_PASSWORD must
  // also be provided or the process exits to prevent insecure defaults.
  if (process.env.RUN_SEED === "true") {
    try {
      await runSeed();
    } catch (seedErr) {
      logger.error({ err: seedErr }, "Seed failed — exiting");
      process.exit(1);
    }
  }
});
