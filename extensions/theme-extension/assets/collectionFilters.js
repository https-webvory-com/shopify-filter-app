// Read saved collection filters independently of product/ranking requests.
(function(){
  if(window.cfpLoadSavedFilters)return;
  const pending=new Map();
  window.cfpLoadSavedFilters=function(params,signal,priority='high'){
    const allowed=['shop','collectionId','collectionHandle','country','locale','language','sortBy','page','limit','responseProfile','customer_tags'];
    if([...params.keys()].some(key=>!allowed.includes(key))||!['best-selling','bestselling'].includes(params.get('sortBy')||'best-selling'))return Promise.resolve(null);
    const query=new URLSearchParams(params);query.set('page','1');query.set('limit','25');query.delete('responseProfile');query.sort();
    const url='https://aisearchfilter.webvory.com/api/collection-filters?'+query;
    if(pending.has(url))return pending.get(url);
    const task=fetch(url,{signal,cache:'no-cache',priority}).then(async response=>response.status===200?response.json():null).catch(()=>null).finally(()=>pending.delete(url));
    pending.set(url,task);return task;
  };
  function context(){
    const meta=document.querySelector('meta[name="cfp-collection-context"]');
    return {shop:meta?.dataset.shop||window.Shopify?.shop,country:meta?.dataset.country||window.Shopify?.country,
      locale:meta?.dataset.locale||window.Shopify?.locale,customerTags:meta?.dataset.customerTags||window.cfpCustomerTags||''};
  }
  function start(handle){
    const ctx=context();if(!ctx.shop||!ctx.country||!ctx.locale||!handle)return;
    if(pending.size>=2)return;
    return window.cfpLoadSavedFilters(new URLSearchParams({shop:ctx.shop,country:ctx.country,locale:ctx.locale,collectionHandle:handle,sortBy:'best-selling',...(ctx.customerTags?{customer_tags:ctx.customerTags}:{})}),undefined,'low');
  }
  // Collection-link intent warms the browser's validated HTTP cache and API
  // connection. Navigation still validates, so a merchant save is respected.
  let lastIntent=0,intentWindow=Date.now(),intentCount=0;
  const prefetched=new Set();
  function intent(event){
    if(navigator.connection?.saveData||Date.now()-lastIntent<500)return;
    if(Date.now()-intentWindow>=60000){intentWindow=Date.now();intentCount=0;prefetched.clear();}
    if(intentCount>=8)return;
    const link=event.target.closest?.('a[href]');if(!link)return;
    const url=new URL(link.href,location.href);
    const match=url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?collections\/([^/]+)\/?$/i);
    if(url.origin!==location.origin||url.search||!match)return;
    if(prefetched.has(url.pathname))return;
    prefetched.add(url.pathname);intentCount++;
    lastIntent=Date.now();start(decodeURIComponent(match[1]));
  }
  document.addEventListener('pointerover',intent,{passive:true,capture:true});
  document.addEventListener('pointerdown',intent,{passive:true,capture:true});
  document.addEventListener('focusin',intent,{capture:true});
  const match=location.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?collections\/([^/]+)\/?$/i);
  if(match){
    const ctx=context();
    if(ctx.shop&&ctx.country&&ctx.locale){
      const params=new URLSearchParams({shop:ctx.shop,country:ctx.country,locale:ctx.locale,collectionHandle:decodeURIComponent(match[1]),sortBy:new URLSearchParams(location.search).get('sortBy')||'best-selling',...(ctx.customerTags?{customer_tags:ctx.customerTags}:{})});
      window._cfpSavedFilters={params:params.toString(),promise:window.cfpLoadSavedFilters(params)};
    }
  }
  window.dispatchEvent(new Event('cfp-saved-filters-ready'));
})();
