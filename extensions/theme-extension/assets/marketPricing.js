(function () {
  if (window.cfpMarketPricing) return;
  const cache = new Map();
  const savedPrices = new Map();
  const savedPriceReads = new Map();
  const liveCards = new Map();
  let liveSource, liveScope = '', liveShop, liveGeneration = 0, liveTimer, liveRecheck, liveAbort;
  let liveReading = false, liveListeners = false, liveRetry = 0;
  const livePending = new Set();
  const liveVerify = new Set();
  const cleanId = id => String(id).split('/').pop();
  const savedKey = product => [window.Shopify?.shop,window.Shopify?.country,window.Shopify?.currency?.active,cleanId(product.id||'')].join('|');
  function saved(product){
    const context=product.pricingContext;
    return context?.source==='saved'&&/^[A-Z]{2}$/.test(context.country||'')&&/^[A-Z]{3}$/.test(context.currency||'')&&context.country===window.Shopify?.country&&context.currency===window.Shopify?.currency?.active&&
      product.variants?.length>0&&product.variants.every(variant=>variant.price!=null&&variant.price!==''&&Number.isFinite(Number(variant.price))&&Number(variant.price)>=0);
  }
  function useSavedProduct(product,source){
    if(!source||!saved(source))return false;
    const variants=new Map(source.variants.map(variant=>[cleanId(variant.id),variant]));
    if(!product.variants.length||product.variants.some(variant=>!variants.has(cleanId(variant.id))))return false;
    product.variants=product.variants.map(variant=>({...variant,price:variants.get(cleanId(variant.id)).price,compareAtPrice:variants.get(cleanId(variant.id)).compareAtPrice,available:variants.get(cleanId(variant.id)).available}));
    product.priceMin=source.priceMin;product.priceMax=source.priceMax;product.pricingContext=source.pricingContext;
    return true;
  }
  function latest(product) {
    const entry = savedPrices.get(savedKey(product));
    // Live values remain authoritative for this page until a newer event or
    // reconnect read replaces them. An old collection snapshot must not undo
    // an update simply because its one-minute fallback cache expired.
    if (entry?.live && useSavedProduct(product, entry.product)) {
      product._marketPricingApplied = true; product._marketPricingUnavailable = false;
    }
    return product;
  }
  function stopLive() {
    liveGeneration++; liveSource?.close(); liveSource = null;
    liveAbort?.abort(); liveAbort = null;
    clearTimeout(liveTimer); liveTimer = null;
    clearTimeout(liveRecheck); liveRecheck = null;
    liveReading = false; livePending.clear(); liveVerify.clear(); liveScope = '';
  }
  function queueLive(ids, verify = true) {
    ids.forEach(id => { if (liveCards.has(id)) {livePending.add(id);if(verify)liveVerify.add(id);} });
    if (!liveTimer && !liveReading && livePending.size) liveTimer = setTimeout(readLive, 100);
  }
  function scheduleRecheck() {
    clearTimeout(liveRecheck);
    if (!liveScope || document.hidden) return;
    liveRecheck = setTimeout(() => {
      // Market prices can change without a product notification (for example
      // after a currency conversion changes). Revalidate only this loaded page.
      queueLive([...liveCards.keys()]);
      scheduleRecheck();
    }, 60000);
  }
  async function readLive() {
    liveTimer = null;
    if (liveReading || !livePending.size || document.hidden || !liveScope) return;
    const generation = liveGeneration, scope = liveScope;
    const country = window.Shopify?.country, currency = window.Shopify?.currency?.active;
    const ids = [...livePending].slice(0, 40);
    const verifyIds = ids.filter(id => liveVerify.has(id));
    ids.forEach(id => livePending.delete(id));
    verifyIds.forEach(id => liveVerify.delete(id));
    liveReading = true;
    const controller = new AbortController(); liveAbort = controller;
    let readTimer;
    try {
      // Ask the server to verify and persist this scope independently. Only IDs
      // and context are sent; trusted Shopify reads supply the saved amounts.
      const origin = typeof API_DOMAIN === 'string' ? API_DOMAIN : 'https://aisearchfilter.webvory.com';
      if(verifyIds.length){
        const params = new URLSearchParams({shop:liveShop,country,currency,ids:verifyIds.join(',')});
        void fetch(origin+'/api/market-prices?'+params,{method:'POST',cache:'no-store',signal:controller.signal}).then(response=>{
          if(!response.ok&&generation===liveGeneration)verifyIds.forEach(id=>liveVerify.add(id));
        }).catch(()=>{if(generation===liveGeneration)verifyIds.forEach(id=>liveVerify.add(id));});
      }
      const params = new URLSearchParams({shop:liveShop,country,currency,ids:ids.join(',')});
      readTimer = setTimeout(()=>controller.abort(),8000);
      const response = await fetch(origin+'/api/market-prices?'+params,{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw Error('Saved price refresh unavailable');
      const data = await response.json();
      clearTimeout(readTimer);
      if(data.country!==country||data.currency!==currency)throw Error('Price scope changed');
      const records = new Map((data.products||[]).filter(product=>ids.includes(cleanId(product.id))&&saved(product)).map(product=>[cleanId(product.id),product]));
      // Initial reads can use the dataset immediately. The server independently
      // verifies those saved amounts; its SSE event is sent only after DB/index
      // completion, so the next read uses the same values as sorting/filtering.
      // Countries with missing coverage retain the existing storefront fallback.
      let next = 0;
      await Promise.all(Array.from({length: Math.min(8, ids.length)}, async () => {
        while (next < ids.length) {
          if (controller.signal.aborted) return;
          const id = ids[next++], card = liveCards.get(id);
          if (records.has(id) || !card?.product.handle) continue;
          try {
            const source = await getProduct(card.product.handle, true, controller.signal);
            if (cleanId(source.id) !== id) throw Error('Storefront product changed');
            const byId = new Map((source.variants || []).map(variant => [cleanId(variant.id), variant]));
            if (!card.product.variants?.length || card.product.variants.some(variant => {
              const value = byId.get(cleanId(variant.id));
              return !value || !Number.isFinite(value.price) || value.price < 0 ||
                (value.compare_at_price != null && (!Number.isFinite(value.compare_at_price) || value.compare_at_price < 0)) || typeof value.available !== 'boolean';
            })) throw Error('Incomplete storefront variant prices');
            records.set(id, {
              id, priceMin: source.price_min / 100, priceMax: source.price_max / 100,
              variants: (source.variants || []).map(variant => ({id: variant.id, price: variant.price / 100, compareAtPrice: variant.compare_at_price == null ? null : variant.compare_at_price / 100, available: variant.available === true})),
              pricingContext: {source: 'saved', country, currency},
            });
          } catch { /* Keep the last displayed price during an outage. */ }
        }
      }));
      if (generation !== liveGeneration || scope !== liveScope || country !== window.Shopify?.country || currency !== window.Shopify?.currency?.active) return;
      for (const id of ids) {
        const card = liveCards.get(id), source = records.get(id);
        if (!card) continue;
        if (!source) { livePending.add(id); liveRetry = 30000; continue; }
        const product = {...card.product, variants: (card.product.variants || []).map(variant => ({...variant}))};
        if (!useSavedProduct(product, source)) continue;
        const before = JSON.stringify((card.product.variants || []).map(variant => [variant.id, variant.price, variant.compareAtPrice, variant.available]));
        savedPrices.set(savedKey(product), {at: Date.now(), product: source, live: true});
        while (savedPrices.size > 500) savedPrices.delete(savedPrices.keys().next().value);
        product._marketPricingApplied = true; product._marketPricingUnavailable = false;
        card.product = product;
        card.onPriced(product);
        const after = JSON.stringify(product.variants.map(variant => [variant.id, variant.price, variant.compareAtPrice, variant.available]));
        if (before !== after) card.onChanged?.();
      }
      if (!livePending.size) liveRetry = 0;
    } catch {
      if (generation === liveGeneration) {
        ids.forEach(id => livePending.add(id));
        liveRetry = Math.min((liveRetry || 1500) * 2, 30000);
      }
    } finally {
      clearTimeout(readTimer);
      if (generation === liveGeneration) {
        liveReading = false;
        liveAbort = null;
        if (livePending.size && !document.hidden) liveTimer = setTimeout(readLive, liveRetry || 100);
      }
    }
  }
  function connectLive() {
    const country = window.Shopify?.country, currency = window.Shopify?.currency?.active;
    const ids = [...liveCards.keys()].sort();
    const params = new URLSearchParams({shop: liveShop, country, currency, ids: ids.join(',')});
    const scope = params.toString();
    if (!window.EventSource || document.hidden || !ids.length || !liveShop || !/^[A-Z]{2}$/.test(country || '') || !/^[A-Z]{3}$/.test(currency || '')) { stopLive(); return; }
    if (liveSource && scope === liveScope) return;
    stopLive(); liveScope = scope;
    const origin = typeof API_DOMAIN === 'string' ? API_DOMAIN : 'https://aisearchfilter.webvory.com';
    let source;
    try { source = new window.EventSource(origin + '/api/price-events?' + params); }
    catch { stopLive(); return; } // Optional live transport must not break cards.
    liveSource = source;
    // Do not depend on stream readiness to correct a stale saved price.
    queueLive(ids);
    scheduleRecheck();
    let connected = false;
    source.addEventListener('ready', () => {
      if (source !== liveSource) return;
      // A delayed first handshake can miss completion of the initial job.
      // Re-read on every ready frame, but only re-verify on later reconnects.
      queueLive([...liveCards.keys()], connected);
      connected = true;
    });
    source.addEventListener('prices', event => {
      if (source !== liveSource) return;
      try { const data = JSON.parse(event.data); if (Array.isArray(data.ids)) queueLive(data.ids, false); } catch { /* Ignore malformed notifications. */ }
    });
  }
  function watchCollection(products, {shop, append = false, onPriced, onChanged}) {
    if (!window.EventSource) return;
    if (!append) liveCards.clear();
    liveShop = shop;
    products.forEach((product, index) => {
      const id = cleanId(product.id || '');
      if (/^\d{1,20}$/.test(id)) liveCards.set(id, {product: latest({...product, variants: (product.variants || []).map(variant => ({...variant}))}), onPriced: value => onPriced(value, index), onChanged});
    });
    while (liveCards.size > 500) liveCards.delete(liveCards.keys().next().value);
    if (!liveListeners) {
      liveListeners = true;
      window.addEventListener('pagehide', stopLive);
      window.addEventListener('pageshow', connectLive);
      window.addEventListener('online', () => { connectLive(); queueLive([...liveCards.keys()]); });
      document.addEventListener('visibilitychange', () => { if (document.hidden) stopLive(); else connectLive(); });
    }
    connectLive();
  }
  async function readSavedPage(products){
    const shop=window.Shopify?.shop,country=window.Shopify?.country,currency=window.Shopify?.currency?.active;
    const result=new Map();
    const missing=products.filter(product=>{
      if(saved(product))return false;
      const entry=savedPrices.get(savedKey(product));
      if(entry&&(entry.live||Date.now()-entry.at<60000)&&useSavedProduct(product,entry.product)){result.set(cleanId(product.id),entry.product);return false;}
      if(entry)savedPrices.delete(savedKey(product));
      return true;
    });
    const ids=[...new Set(missing.map(product=>cleanId(product.id||'')).filter(id=>/^\d+$/.test(id)))];
    if(!shop||!country||!currency||!ids.length||ids.length>40)return result;
    const readKey=[shop,country,currency,...[...ids].sort()].join('|');
    if(savedPriceReads.has(readKey)){
      for(const [id,product]of await savedPriceReads.get(readKey))result.set(id,product);
      return result;
    }
    const read=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
    try{
      const params=new URLSearchParams({shop,country,currency,ids:ids.join(',')});
      const origin=typeof API_DOMAIN==='string'?API_DOMAIN:'https://aisearchfilter.webvory.com';
      const response=await fetch(origin+'/api/market-prices?'+params,{signal:controller.signal,cache:'no-store',priority:'high'});
      if(!response.ok)return new Map();
      const data=await response.json();
      if(data.country!==country||data.currency!==currency)return new Map();
      const records=new Map((data.products||[]).filter(product=>ids.includes(cleanId(product.id))&&saved(product)).map(product=>[cleanId(product.id),product]));
      // Cache only the requested records, scoped to this shop/country/currency.
      for(const product of records.values())savedPrices.set(savedKey(product),{at:Date.now(),product});
      while(savedPrices.size>200)savedPrices.delete(savedPrices.keys().next().value);
      return records;
    }catch{return new Map();}finally{clearTimeout(timer);}
    })();
    savedPriceReads.set(readKey,read);
    try{for(const [id,product]of await read)result.set(id,product);return result;}
    finally{savedPriceReads.delete(readKey);}
  }
  async function getProduct(handle, fresh = false, signal) {
    const root = window.Shopify?.routes?.root || '/';
    const key = [root, window.Shopify?.country, window.Shopify?.currency?.active, handle].join('|');
    const saved = cache.get(key);
    if (!fresh && saved && Date.now() - saved.at < 60000) return saved.promise;
    const promise = (async () => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener('abort', abort, {once: true});
      // HTTP/1 connections can queue these behind the first product images.
      // Keep the price request alive through that queue without holding cards.
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`${root}products/${encodeURIComponent(handle)}.js`, {
          credentials: 'same-origin', signal: controller.signal, priority: 'high', cache: fresh ? 'no-store' : 'default',
        });
        if (!response.ok) throw new Error('Storefront price unavailable');
        const product = await response.json();
        if (!Number.isFinite(product.price_min) || !Number.isFinite(product.price_max)) throw new Error('Invalid storefront price');
        return product;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    })();
    cache.set(key, {at:Date.now(),promise});
    while (cache.size > 200) cache.delete(cache.keys().next().value);
    promise.catch(() => cache.delete(key));
    return promise;
  }
  window.cfpMarketPricing = {
    saved,
    latest,
    watchCollection,
    async apply(products, onPriced) {
      // Clone cached search data so one market never changes another market's result.
      const result = products.map(p => ({...p,variants:(p.variants || []).map(v=>({...v}))}));
      const published=new Set();
      const publish=(product,index)=>{product._marketPricingApplied=true;product._marketPricingUnavailable=false;published.add(index);if(onPriced)onPriced(product,index);};
      // Already verified records are usable immediately, even when another
      // product's background database read is slow or unavailable.
      result.forEach((product,index)=>{
        const entry=savedPrices.get(savedKey(product));
        if(!saved(product)&&entry&&(entry.live||Date.now()-entry.at<60000))useSavedProduct(product,entry.product);
        if(saved(product))publish(product,index);
      });
      const stored=await readSavedPage(result);
      for(const product of result){
        useSavedProduct(product,stored.get(cleanId(product.id)));
      }
      let next = 0;
      await Promise.all(Array.from({length:Math.min(8,result.length)},async()=>{
        while (next < result.length) {
          const product = result[next++];
          if(published.has(result.indexOf(product)))continue;
          try {
            if(saved(product)){
              product._marketPricingApplied=true;product._marketPricingUnavailable=false;
              if(onPriced)onPriced(product,result.indexOf(product));
              continue;
            }
            if (!product.handle) throw new Error('Product handle unavailable');
            const source = await getProduct(product.handle);
            product.priceMin = source.price_min / 100;
            product.priceMax = source.price_max / 100;
            const variants = new Map((source.variants || []).map(v=>[cleanId(v.id),v]));
            for (const variant of product.variants) {
              const marketVariant = variants.get(cleanId(variant.id));
              if (!marketVariant || !Number.isFinite(marketVariant.price)) throw new Error('Variant price unavailable');
              variant.price = marketVariant.price / 100;
              variant.compareAtPrice = marketVariant.compare_at_price == null ? null : marketVariant.compare_at_price / 100;
              variant.available = marketVariant.available === true;
            }
            product._marketPricingApplied = true;
            product._marketPricingUnavailable = false;
          } catch (error) {
            product._marketPricingApplied = false;
            product._marketPricingUnavailable = true;
          }
          if (onPriced) onPriced(product, result.indexOf(product));
        }
      }));
      return result;
    },
  };
  if(typeof window.dispatchEvent==='function')window.dispatchEvent(new Event('cfp:market-pricing-ready'));
})();
