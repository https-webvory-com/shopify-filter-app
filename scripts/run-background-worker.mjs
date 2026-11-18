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
    if (global.__productSyncWorker && global.__webhookWorker && global.__collectionRankingWorker && global.__searchIndexWorker && global.__synonymWorker && global.__collectionOrderWorker && global.__collectionMembershipWorker && global.__marketAvailabilityWorker &&
        typeof global.__scheduleCatalogDriftAudits==='function' &&
        typeof global.__reconcileLegacySynonymIndexes==='function') {
      workers = [global.__productSyncWorker, global.__webhookWorker, global.__collectionRankingWorker, global.__searchIndexWorker, global.__synonymWorker, global.__collectionOrderWorker, global.__collectionMembershipWorker, global.__marketAvailabilityWorker];
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
  let catalogAuditing=false;
  const catalogAudit=async()=>{if(catalogAuditing||shuttingDown)return;catalogAuditing=true;try{
    const {scheduleUnclassifiedSizeMappingRebuilds}=await import('../app/services/sizeMapping.server.js');
    await scheduleUnclassifiedSizeMappingRebuilds().catch(error=>console.error('CFP size mapping backfill scheduler unavailable:',error.name));
    await global.__scheduleCatalogDriftAudits();
  }catch(error){console.error('CFP catalog drift scheduler unavailable:',error.name);}finally{catalogAuditing=false;}};
  const catalogAuditTimer=setInterval(catalogAudit,3600000);catalogAuditTimer.unref();
  let reconcilingSynonyms=false;
  const reconcileSynonyms=async()=>{if(reconcilingSynonyms||shuttingDown)return;reconcilingSynonyms=true;try{
    await global.__reconcileLegacySynonymIndexes();
  }catch(error){console.error('CFP synonym migration unavailable:',error.name);}finally{reconcilingSynonyms=false;}};
  const synonymTimer=setInterval(reconcileSynonyms,60000);synonymTimer.unref();
  let expiringAnalytics=false;
  const expireAnalytics=async()=>{if(expiringAnalytics||shuttingDown)return;expiringAnalytics=true;try{
    const {expireSearchAnalytics}=await import('../app/services/searchAnalytics.server.js');
    await expireSearchAnalytics();
  }catch(error){console.error('CFP analytics retention unavailable:',error.name);}finally{expiringAnalytics=false;}};
  const analyticsTimer=setInterval(expireAnalytics,86400000);analyticsTimer.unref();
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(warmupTimer);
    clearInterval(membershipTimer);
    clearInterval(catalogAuditTimer);
    clearInterval(analyticsTimer);
    clearInterval(synonymTimer);
    fs.rmSync(readyFile, { force: true });
    await Promise.all(workers.map(worker => worker.close()));
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  void warm();
  void audit();
  void catalogAudit();
  void expireAnalytics();
  void reconcileSynonyms();
} catch (error) {
  fs.rmSync(readyFile, { force: true });
  console.error("CFP: Background worker startup failed:", error.message);
  process.exit(1);
}
