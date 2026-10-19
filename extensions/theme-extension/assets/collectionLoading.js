(function(){
  if(window._cfpHeadBootstrapLoaded||!location.pathname.includes('/collections/'))return;
  window._cfpHeadBootstrapLoaded=true;
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
            .then(async function(response) {return {status:response.status,payload:await response.json()};})
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
  
