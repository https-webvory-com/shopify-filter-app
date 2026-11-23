// Public notifications contain IDs only. Prices are read separately in the
// shopper's country/currency, using the existing bounded price endpoint.
export const PRICE_EVENT_CHANNEL = 'cfp:product-prices:v1';
export function priceEventScope(url) {
  const shop = url.searchParams.get('shop');
  const country = url.searchParams.get('country');
  const currency = url.searchParams.get('currency');
  const ids = [...new Set((url.searchParams.get('ids') || '').split(',').filter(Boolean))];
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || '') ||
      !/^[A-Z]{2}$/.test(country || '') || !/^[A-Z]{3}$/.test(currency || '') ||
      !ids.length || ids.length > 500 || ids.some(id => !/^\d{1,20}$/.test(id))) return null;
  return {shop, country, currency, ids};
}

// One Redis subscription per web process, shared by all browser connections.
export function createPriceEventHub(makeSubscriber, {maximumClients = 500} = {}) {
  const clients = new Set();
  let subscriber, subscribed = false;
  function subscribe(scope, send) {
    if (clients.size >= maximumClients) throw Error('Price stream capacity reached');
    const client = {scope, send};
    clients.add(client);
    if (!subscriber) {
      const connection = makeSubscriber();
      subscriber = connection;
      connection.on('error', () => {}); // Existing cards remain usable offline.
      connection.on('ready', () => {
        connection.subscribe(PRICE_EVENT_CHANNEL).then(() => {
          if (subscriber === connection) {
            subscribed = true;
            for (const item of clients) item.send('ready', {});
          }
        }).catch(() => {});
      });
      connection.on('close', () => { if (subscriber === connection) subscribed = false; });
      connection.on('message', (channel, raw) => {
        if (subscriber !== connection || channel !== PRICE_EVENT_CHANNEL) return;
        let event;
        try { event = JSON.parse(raw); } catch { return; }
        if (typeof event.shop !== 'string' || !Array.isArray(event.ids)) return;
        for (const item of clients) {
          if (item.scope.shop !== event.shop) continue;
          const ids = item.scope.ids.filter(id => event.ids.includes(id));
          if (ids.length) item.send('prices', {ids});
        }
      });
      connection.connect().catch(() => {});
    } else if (subscribed) {
      // Recheck prices on every browser reconnect, including missed events.
      queueMicrotask(() => { if (clients.has(client)) send('ready', {}); });
    }
    return () => {
      clients.delete(client);
      if (!clients.size && subscriber) {
        const old = subscriber;
        subscriber = undefined;
        subscribed = false;
        old.disconnect();
      }
    };
  }
  return {subscribe};
}

export function priceEventResponse(request, scope, hub, {heartbeatMs = 20000, lifetimeMs = 300000} = {}) {
  let stop = () => {};
  const body = new ReadableStream({
    start(controller) {
      let closed = false, unsubscribe, heartbeat, expiry;
      stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat); clearTimeout(expiry);
        unsubscribe?.();
        request.signal.removeEventListener('abort', stop);
        try { controller.close(); } catch { /* Already cancelled. */ }
      };
      const send = (event, value) => {
        if (closed) return;
        // Bound memory for clients that stop reading but do not disconnect.
        if (controller.desiredSize <= 0) { stop(); return; }
        controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
      };
      controller.enqueue(new TextEncoder().encode('retry: 3000\n\n'));
      try { unsubscribe = hub.subscribe(scope, send); } catch { stop(); return; }
      heartbeat = setInterval(() => send('heartbeat', {}), heartbeatMs);
      expiry = setTimeout(stop, lifetimeMs);
      request.signal.addEventListener('abort', stop, {once: true});
      if (request.signal.aborted) stop();
    },
    cancel() { stop(); },
  }, {highWaterMark: 32});
  return new Response(body, {headers: {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    'Access-Control-Allow-Origin': '*', 'X-Accel-Buffering': 'no',
  }});
}

export function productPriceFingerprint(product) {
  return JSON.stringify((product?.variantPrices || []).map(variant => [
    String(variant.id), variant.price, variant.compareAtPrice, variant.available,
    Object.entries(variant.marketPrices || {}).sort(([a], [b]) => a.localeCompare(b)),
  ]).sort(([a], [b]) => a.localeCompare(b)));
}
