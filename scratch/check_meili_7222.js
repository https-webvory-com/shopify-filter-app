import meiliClient from '../app/services/meiliClient.server.js';

async function check() {
  try {
    const index = meiliClient.index('products');
    const doc = await index.getDocument('7222430662717');
    console.log("MEILISEARCH DOC 7222430662717:");
    console.log(JSON.stringify(doc, null, 2));
  } catch (e) {
    console.error("Meili check error:", e);
  }
}

check();
