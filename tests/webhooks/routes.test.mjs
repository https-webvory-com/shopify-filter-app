import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

async function loadRoute(name, auth, enqueue) {
  const source = (await fs.readFile(`app/routes/webhooks.${name}.jsx`, "utf8"))
    .replace(/^import .*;\r?\n/gm, "")
    .replace("export const action", "const action");
  const context = vm.createContext({
    authenticate: { webhook: auth }, enqueueWebhookJob: enqueue, Response,
    console: { log() {}, error() {} },
  });
  vm.runInContext(source, context);
  return vm.runInContext("action", context);
}

for (const [route, topic] of [
  ["products", "PRODUCTS_UPDATE"], ["collections", "COLLECTIONS_UPDATE"],
  ["orders", "ORDERS_PAID"], ["app.uninstalled", "APP_UNINSTALLED"],
]) {
  test(`${route} acknowledges only after the queue accepts the event`, async () => {
    let release;
    const queued = new Promise((resolve) => { release = resolve; });
    let acknowledged = false;
    const payload = { id: 123 };
    const action = await loadRoute(route,
      async () => ({ shop: "fixture", topic, payload, admin: {} }),
      async (name, data) => {
        assert.equal(name, topic);
        assert.equal(data.shop, "fixture");
        if (route !== "app.uninstalled") assert.equal(data.payload, payload);
        await queued;
      });
    const response = action({ request: {} }).then((result) => { acknowledged = true; return result; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(acknowledged, false);
    release();
    assert.equal((await response).status, 200);
  });

  test(`${route} returns 500 on queue failure so Shopify can retry`, async () => {
    const action = await loadRoute(route,
      async () => ({ shop: "fixture", topic, payload: {}, admin: {} }),
      async () => { throw new Error("Redis unavailable"); });
    assert.equal((await action({ request: {} })).status, 500);
  });

  test(`${route} preserves authentication rejection without enqueueing`, async () => {
    const rejection = new Response("Invalid HMAC", { status: 401 });
    const action = await loadRoute(route, async () => { throw rejection; },
      async () => assert.fail("Unauthenticated event must not be queued"));
    await assert.rejects(action({ request: {} }), (error) => error === rejection);
  });
}
