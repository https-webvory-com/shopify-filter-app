import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

process.env.CFP_WORKER_MODE = "worker";
const readyFile = "/tmp/cfp-background-worker.ready";
fs.rmSync(readyFile, { force: true });

try {
  // Importing the built services does not start an HTTP listener.
  await import("../build/server/index.js");
  let workers;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (global.__productSyncWorker && global.__webhookWorker) {
      workers = [global.__productSyncWorker, global.__webhookWorker];
      break;
    }
    await delay(1000);
  }
  if (!workers) throw new Error("Background workers could not connect to Redis");
  await Promise.all(workers.map(worker => worker.waitUntilReady()));
  fs.writeFileSync(readyFile, String(process.pid));
  console.log("CFP: Dedicated background workers are ready");

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    fs.rmSync(readyFile, { force: true });
    await Promise.all(workers.map(worker => worker.close()));
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
} catch (error) {
  fs.rmSync(readyFile, { force: true });
  console.error("CFP: Background worker startup failed:", error.message);
  process.exit(1);
}
