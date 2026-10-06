import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

async function loadWorker(syncError) {
  const calls = [];
  const admin = {};
  const source = (await fs.readFile("app/workers/webhookWorker.server.js", "utf8"))
    .replace(/^import .*;\r?\n/gm, "")
    .replaceAll("await import(", "await loadModule(")
    .replace("export function initWebhookWorker", "function initWebhookWorker");
  const context = vm.createContext({
    console: { log() {}, error() {} },
    prisma: { session: { deleteMany: async (query) => calls.push(["uninstall", query.where.shop]) } },
    async loadModule(path) {
      if (path.includes("shopify.server")) return { unauthenticated: { admin: async (shop) => {
        calls.push(["admin", shop]); return { admin };
      } } };
      if (path.includes("sync.server")) return { syncSingleProduct: async (shop, client, id, options) => {
        assert.equal(client, admin);
        assert.equal(options.retrySearchErrors, true);
        calls.push(["sync", shop, id]);
        if (syncError) throw syncError;
      } };
      if (path.includes("shopCache")) return { invalidateShop: async (shop) => calls.push(["invalidate", shop]) };
      throw new Error(`Unexpected module: ${path}`);
    },
  });
  vm.runInContext(source, context);
  return { process: vm.runInContext("processWebhookJob", context), calls };
}

for (const topic of ["PRODUCTS_CREATE", "PRODUCTS_UPDATE", "products/update"]) {
  test(`${topic} syncs the product and invalidates the shop cache`, async () => {
    const worker = await loadWorker();
    await worker.process({ name: topic, data: { shop: "fixture.myshopify.com", payload: { id: 123 } } });
    assert.deepEqual(worker.calls, [
      ["admin", "fixture.myshopify.com"],
      ["sync", "fixture.myshopify.com", "gid://shopify/Product/123"],
      ["invalidate", "fixture.myshopify.com"],
    ]);
  });
}

test("sync errors escape the processor so BullMQ retries the job", async () => {
  const error = new Error("Search unavailable");
  const worker = await loadWorker(error);
  await assert.rejects(worker.process({ name: "PRODUCTS_UPDATE", data: { shop: "fixture", payload: { id: 123 } } }), error);
  assert.equal(worker.calls.some(([type]) => type === "invalidate"), false);
});

test("uninstall cleanup deletes only the shop's sessions", async () => {
  const worker = await loadWorker();
  await worker.process({ name: "APP_UNINSTALLED", data: { shop: "fixture", payload: {} } });
  assert.deepEqual(worker.calls, [["uninstall", "fixture"]]);
});
