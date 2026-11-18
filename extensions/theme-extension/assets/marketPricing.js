(function () {
  if (window.cfpMarketPricing) return;
  const cache = new Map();
  const savedPrices = new Map();
  const savedPriceReads = new Map();
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
  async function readSavedPage(products){
    const shop=window.Shopify?.shop,country=window.Shopify?.country,currency=window.Shopify?.currency?.active;
    const result=new Map();
    const missing=products.filter(product=>{
      if(saved(product))return false;
      const entry=savedPrices.get(savedKey(product));
      if(entry&&Date.now()-entry.at<60000&&useSavedProduct(product,entry.product)){result.set(cleanId(product.id),entry.product);return false;}
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
    saved,
    async apply(products, onPriced) {
      // Clone cached search data so one market never changes another market's result.
      const result = products.map(p => ({...p,variants:(p.variants || []).map(v=>({...v}))}));
      const published=new Set();
      const publish=(product,index)=>{product._marketPricingApplied=true;product._marketPricingUnavailable=false;published.add(index);if(onPriced)onPriced(product,index);};
      // Already verified records are usable immediately, even when another
      // product's background database read is slow or unavailable.
      result.forEach((product,index)=>{
        const entry=savedPrices.get(savedKey(product));
        if(!saved(product)&&entry&&Date.now()-entry.at<60000)useSavedProduct(product,entry.product);
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
