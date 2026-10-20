(function(){
  if(window._cfpHeadBootstrapLoaded||!location.pathname.includes('/collections/'))return;
  window._cfpHeadBootstrapLoaded=true;
  function preloadImages(payload){
    if(!document.head||payload?.debug?.collectionRankingStatus!=='ready')return;
    for(const product of (payload.products||[]).slice(0,4)){
      // Only preload an explicit merchandising image that a swatch also uses.
      // Other cards can choose a collection-specific or filtered image later.
      const image=product.merchandisingImage;
      if(typeof image!=='string'||!image.includes('cdn.shopify.com')||
        Object.keys(product).some(key=>key.startsWith('metafield_custom.')&&product[key]))continue;
      const base=value=>value.split('?')[0].replace(/^https?:/,'').toLowerCase();
      if(!product.variants?.some(variant=>typeof variant.imageUrl==='string'&&base(variant.imageUrl)===base(image)))continue;
      const resize=width=>{
        const clean=image.replace(/([?&])width=\d+/g,'$1').replace(/&+/g,'&').replace(/\?&/,'?');
        return clean+(clean.includes('?')?'&':'?')+'width='+width;
      };
      const link=document.createElement('link');link.rel='preload';link.as='image';link.fetchPriority='high';
      link.href=resize(360);link.imageSrcset=[180,360,540].map(width=>resize(width)+' '+width+'w').join(', ');
      link.imageSizes='(max-width: 480px) 50vw, (max-width: 900px) 33vw, 25vw';document.head.append(link);
    }
  }
  function start(){
      try {
        var meta=document.querySelector('meta[name="cfp-collection-context"]');
        if(!meta)return false;
        var context=window.cfpCollectionContext={shop:meta.dataset.shop,handle:meta.dataset.handle,country:meta.dataset.country,locale:meta.dataset.locale,customerTags:meta.dataset.customerTags||''};
        if(typeof window.cfpCustomerTags==='undefined')window.cfpCustomerTags=context.customerTags;
        var query = new URLSearchParams(location.search);
        if (query.has('page') && query.get('page') !== '1') return;
        if ([...query.keys()].some(function(key) {
          return !['page','sortBy','rankingToken','preview_theme_id','_fd','_sc','pb','gclid','fbclid'].includes(key) && !key.startsWith('utm_');
        })) return;
        var sort = query.get('sortBy') || 'best-selling';
        if (!['best-selling','bestselling'].includes(sort) || !context.country || !context.locale || !context.handle) return;
        var params = new URLSearchParams({shop:context.shop,collectionHandle:context.handle,country:context.country,locale:context.locale,sortBy:sort,page:'1',limit:'25'});
        if (context.customerTags) params.set('customer_tags',context.customerTags);
        params.set('responseProfile',context.customerTags ? 'collection-v1' : 'collection-cards-v1');
        params.sort();
        var url = 'https://aisearchfilter.webvory.com/api/filter?' + params;
        var previous = window._cfpRankedEarlyFetch;
        if (previous && previous.url === url) return;
        previous?.controller.abort();
        var controller = new AbortController();
        var timer = setTimeout(function() {controller.abort();},30000);
        window._cfpRankedEarlyFetch = {
          url:url,controller:controller,configurationPromise:null,
          promise:fetch(url,{signal:controller.signal,cache:'no-cache'})
            .then(async function(response) {const payload=await response.json();try{if(response.status===200)preloadImages(payload);}catch{}return {status:response.status,payload};})
            .catch(function() {return null;})
            .finally(function() {clearTimeout(timer);})
        };
      } catch(error) {}
      return true;
  }
  if(start()!==false)return;
  let finished=false;
  const attempt=()=>{if(!finished&&start()!==false){finished=true;observer.disconnect();}};
  const observer=new MutationObserver(attempt);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',()=>{if(!finished){observer.disconnect();attempt();}},{once:true});
})();
  
