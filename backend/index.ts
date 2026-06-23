/**
 * backend/index.ts
 * Agent process entry point.
 * Registers SIGTERM/SIGINT handlers and orchestrates graceful shutdown.
 */

import { PayFiAgent } from "./agent";
import { createHealthServer } from "./server";
import { db } from "./db/client";

const agent = new PayFiAgent();
const healthServer = createHealthServer();

const HARD_KILL_MS = 10_000;
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Graceful shutdown initiated... (${signal})`);

  // Hard kill: force exit if shutdown hangs beyond 10 seconds
  const hardKill = setTimeout(() => {
    console.error("[Shutdown] Hard kill: graceful shutdown exceeded 10s — forcing exit(1)");
    process.exit(1);
  }, HARD_KILL_MS);

  try {
    // 1. Stop accepting new tasks
    agent.drain();

    // 2. Wait for in-flight tasks to settle
    await agent.waitForPendingTasks();

    // 3. Stop the health check server
    await new Promise<void>((resolve, reject) =>
      healthServer.close((err) => (err ? reject(err) : resolve()))
    );

    // 4. Close database connection
    await db.close();

    clearTimeout(hardKill);
    console.log("[Shutdown] All resources released — exiting cleanly.");
    process.exit(0);
  } catch (err) {
    console.error("[Shutdown] Error during shutdown sequence:", err);
    clearTimeout(hardKill);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

export { agent };
