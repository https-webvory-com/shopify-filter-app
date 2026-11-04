(function () {
  if (window.cfpMarketPricing) return;
  const cache = new Map();
  const cleanId = id => String(id).split('/').pop();
  async function getProduct(handle) {
    const root = window.Shopify?.routes?.root || '/';
    const key = [root, window.Shopify?.country, window.Shopify?.currency?.active, handle].join('|');
    const saved = cache.get(key);
    if (saved && Date.now() - saved.at < 60000) return saved.promise;
    const promise = (async () => {
      const controller = new AbortController();
      // HTTP/1 connections can queue these behind the first product images.
      // Keep the price request alive through that queue without holding cards.
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`${root}products/${encodeURIComponent(handle)}.js`, {
          credentials: 'same-origin', signal: controller.signal, priority: 'high',
        });
        if (!response.ok) throw new Error('Storefront price unavailable');
        const product = await response.json();
        if (!Number.isFinite(product.price_min) || !Number.isFinite(product.price_max)) throw new Error('Invalid storefront price');
        return product;
      } finally { clearTimeout(timer); }
    })();
    cache.set(key, {at:Date.now(),promise});
    while (cache.size > 200) cache.delete(cache.keys().next().value);
    promise.catch(() => cache.delete(key));
    return promise;
  }
  window.cfpMarketPricing = {
    async apply(products, onPriced) {
      // Clone cached search data so one market never changes another market's result.
      const result = products.map(p => ({...p,variants:(p.variants || []).map(v=>({...v}))}));
      let next = 0;
      await Promise.all(Array.from({length:Math.min(8,result.length)},async()=>{
        while (next < result.length) {
          const product = result[next++];
          try {
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
