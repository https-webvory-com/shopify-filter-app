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
    if (global.__productSyncWorker && global.__webhookWorker && global.__collectionRankingWorker && global.__collectionOrderWorker && global.__collectionMembershipWorker) {
      workers = [global.__productSyncWorker, global.__webhookWorker, global.__collectionRankingWorker, global.__collectionOrderWorker, global.__collectionMembershipWorker];
      break;
    }
    await delay(1000);
  }
  if (!workers) throw new Error("Background workers could not connect to Redis");
  await Promise.all(workers.map(worker => worker.waitUntilReady()));
  fs.writeFileSync(readyFile, String(process.pid));
  console.log("CFP: Dedicated background workers are ready");

  let shuttingDown = false;
  let warming = false;
  const warm = async () => {
    if (warming || shuttingDown) return;
    warming = true;
    try { await global.__schedulePublicCollectionWarmups?.(); }
    catch (error) { console.error('CFP: Collection warmup scheduler unavailable:', error.name); }
    finally { warming = false; }
  };
  const warmupTimer = setInterval(warm, 60000);
  warmupTimer.unref();
  let auditing=false;
  const audit=async()=>{if(auditing||shuttingDown)return;auditing=true;try{await global.__scheduleMembershipAudits?.();}catch(error){console.error('CFP Membership scheduler unavailable:',error.name);}finally{auditing=false;}};
  const membershipTimer=setInterval(audit,60000);membershipTimer.unref();
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(warmupTimer);
    clearInterval(membershipTimer);
    fs.rmSync(readyFile, { force: true });
    await Promise.all(workers.map(worker => worker.close()));
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  void warm();
  void audit();
} catch (error) {
  fs.rmSync(readyFile, { force: true });
  console.error("CFP: Background worker startup failed:", error.message);
  process.exit(1);
}
