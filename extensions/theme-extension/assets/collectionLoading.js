(function(){
  if(window._cfpHeadBootstrapLoaded||!location.pathname.includes('/collections/'))return;
  window._cfpHeadBootstrapLoaded=true;
  function firstRowSelection(product,handle,settings){
    const image=value=>typeof value==='string'?value:value?.url||value?.src||value?.image?.url||'';
    const id=value=>String(value||'').split('/').pop();
    const variants=product.variants||[];
    const selected=product.selectedVariantId&&variants.find(v=>id(v.id)===id(product.selectedVariantId));
    let variantId=selected?id(selected.id):id(variants.find(v=>v.available===true)?.id);
    const name=String(handle||'').toLowerCase();let custom='';
    if(/plus-size|plus size/.test(name))custom=image(product['metafield_custom.plus_size_collection_image']);
    else {
      const mob=image(product['metafield_custom.mob_collection_image'])||image(product['metafield_custom.mother_of_the_bride_collection_image']);
      if(/mother-of-the-bride|mother of the bride|mob/.test(name)&&mob)custom=mob;
      else if(name.includes('wedding'))custom=image(product['metafield_custom.wedding_collection_image']);
    }
    let primary=(product.searchColor?product.searchColorImage:custom||selected?.imageUrl||product.merchandisingImage||image(product.images?.[0]))||'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_600x.gif';
    let options=product.options||[];try{if(typeof options==='string')options=JSON.parse(options);}catch{options=[];}
    let position=options.findIndex(o=>['color','colour'].includes(String(o.name).toLowerCase()));
    if(position<0&&variants.length){
      const known=Object.keys(settings?.swatchConfig?.colors||{});
      const colors=(known.length?known:['black','white','ivory','red','blue','green','yellow','pink','purple','navy','burgundy','champagne','silver','gold','blush','dusty rose','hunter green','royal blue','emerald','mauve','lilac','sage']).map(v=>v.toLowerCase().trim());
      const sample=variants.find(v=>v.option1||v.option2)||variants[0];
      if(colors.includes(String(sample.option1||'').toLowerCase().trim()))position=0;
      else if(colors.includes(String(sample.option2||'').toLowerCase().trim()))position=1;
    }
    if(position>=0){
      const key='option'+(position+1),colors=new Map();
      for(const variant of variants){const color=variant[key];if(!color)continue;
        const src=variant.imageUrl||image(variant.image),existing=colors.get(color);
        if(!existing||!existing.image&&src)colors.set(color,{image:src,id:id(variant.id)});
      }
      const rows=[...colors];if(rows.length){let active=0,override=false;
        if(product.selectedVariantId&&selected){const found=rows.findIndex(([color])=>color.toLowerCase()===String(selected[key]||'').toLowerCase());if(found>=0){active=found;override=true;}}
        else if(product.merchandisingImage){const base=value=>String(value).split('?')[0].replace(/^https?:/,'').toLowerCase(),merch=base(product.merchandisingImage);
          let found=rows.findIndex(([,value])=>value.image&&(base(value.image).includes(merch)||merch.includes(base(value.image))));
          if(found<0)found=rows.findIndex(([color])=>/black|nude/i.test(color));
          if(found>=0){active=found;override=true;if(rows[active][1].id)variantId=rows[active][1].id;}
        }
        const color=rows[active][1];if(color.image&&(!custom||override))primary=color.image;
        variantId=product.selectedVariantId&&variantId||color.id||variantId;
      }
    }
    return {image:product.pinnedProductImage||primary,url:'/products/'+encodeURIComponent(product.handle)+(variantId&&/^\d+$/.test(variantId)?'?variant='+variantId:'')};
  }
  window.cfpFirstRowSelection=firstRowSelection;
  function mountFirstRow(payload,context,controller){
    if(payload?.cfpCards?.version!==1||!['ready','prefix-ready'].includes(payload.debug?.collectionRankingStatus)||!payload.products?.length)return;
    if(controller.cfpPreviewUpdate){controller.cfpPreviewUpdate(payload);return;}
    let grid,scheduled=false,timer,rendered=0;
    const dismissSkeleton=()=>{const overlay=document.getElementById('cfp-skeleton-overlay');if(overlay){overlay.classList.add('cfp-skeleton-done');overlay.style.setProperty('display','none','important');}};
    const stop=()=>{observer.disconnect();clearTimeout(timer);controller.signal.removeEventListener('abort',stop);delete controller.cfpPreviewUpdate;grid?.remove();};
    const inspect=()=>{scheduled=false;
      // The widget installs skeletons before it can adopt the early response.
      // Keep actual cards visible until their real replacements are mounted.
      if(controller.signal.aborted||document.querySelector('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)')){stop();return;}
      const app=document.querySelector('.cfp-v1-app-container');if(!app)return;
      if(!grid){
      grid=document.createElement('div');grid.id='cfp-first-row';grid.className='cfp-first-row';
      // Use the app block's settings before the full widget runs. Match the
      // final grid's breakpoints and spacing so early cards never reflow 4→5.
      const style=document.createElement('style');style.textContent='.cfp-first-row{display:grid;grid-template-columns:repeat(var(--cfp-cols-desktop,3),minmax(0,1fr));gap:10px;padding:0;margin:0;width:100%;box-sizing:border-box}.cfp-first-row a{display:block;color:inherit;text-decoration:none}.cfp-first-row img{display:block;width:100%;height:auto;aspect-ratio:2/3;object-fit:cover}.cfp-first-row h3{font:inherit;font-size:14px;line-height:1.4;margin:12px 0;text-align:center}@media(max-width:768px){.cfp-first-row{grid-template-columns:repeat(var(--cfp-cols-mobile,2),minmax(0,1fr));gap:16px}}@media(max-width:480px){.cfp-first-row{gap:12px}}';grid.append(style);
      }
      const placeholders=grid.querySelectorAll('.cfp-first-row-placeholder');
      const missing=Math.max(0,Math.min(25,payload.totalCount||25)-payload.products.length);
      // A refreshed response can replace a browser-cached row or change its
      // order. Keep the unchanged prefix and replace cards from the first diff.
      const existing=[...grid.querySelectorAll('.cfp-initial-product')];
      const mismatch=existing.findIndex((card,index)=>card.dataset.productId!==String(payload.products[index]?.id||''));
      if(mismatch>=0){existing.slice(mismatch).forEach(card=>card.remove());rendered=mismatch;}
      if(payload.products.length===rendered&&placeholders.length===missing){dismissSkeleton();return;}
      placeholders.forEach(card=>card.remove());
      for(const [index,product] of payload.products.entries()){
        if(index<rendered)continue;
        const selection=firstRowSelection(product,context.handle,payload.globalSettings),card=document.createElement('div'),link=document.createElement('a'),img=document.createElement('img'),title=document.createElement('h3');
        card.className='cfp-initial-product';card.dataset.productId=String(product.id);link.href=selection.url;img.alt=product.title;img.width=360;img.height=480;img.fetchPriority=index<5?'high':'low';if(index>=5)img.loading='lazy';img.decoding='async';
        const resize=width=>{const clean=selection.image.replace(/([?&])width=\d+/g,'$1').replace(/&+/g,'&').replace(/\?&/,'?');return clean.includes('cdn.shopify.com')?clean+(clean.includes('?')?'&':'?')+'width='+width:clean;};
        img.src=resize(360);if(selection.image.includes('cdn.shopify.com')){img.srcset=[180,360,540].map(width=>resize(width)+' '+width+'w').join(', ');img.sizes='(max-width: 480px) 50vw, (max-width: 900px) 33vw, 25vw';}
        const selectedId=new URL(selection.url,location.origin).searchParams.get('variant');
        const sku=product.variants?.find(variant=>String(variant.id).split('/').pop()===selectedId)?.sku||product.variants?.find(variant=>variant.sku)?.sku||product.sku||'';
        title.textContent=payload.globalSettings?.isWholesale?(String(sku).match(/\d{1,4}/)?.[0]||''):product.title;link.append(img,title);card.append(link);grid.append(card);
      }
      rendered=payload.products.length;
      grid.insertAdjacentHTML('beforeend','<div class="cfp-first-row-placeholder cfp-sk-card" aria-hidden="true"><span class="cfp-sk-image cfp-sk-anim"></span><span class="cfp-sk-title cfp-sk-anim"></span></div>'.repeat(missing));
      if(grid.parentElement!==app)app.prepend(grid);
      dismissSkeleton();
    };
    const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(inspect);}});
    controller.cfpPreviewUpdate=next=>{payload=next;inspect();};
    observer.observe(document.documentElement,{childList:true,subtree:true});controller.signal.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>{if(!grid)stop();},120000);inspect();
  }
  function preloadImages(payload){
    if(!document.head||!['ready','prefix-ready'].includes(payload?.debug?.collectionRankingStatus))return;
    for(const product of (payload.products||[]).slice(0,5)){
      // Preview cards use the same selected image as the independent first row.
      // Full responses only preload an explicit image also used by a swatch.
      const image=payload.cfpCards?.version===1?firstRowSelection(product,window.cfpCollectionContext?.handle,payload.globalSettings).image:product.merchandisingImage;
      if(typeof image!=='string'||!image.includes('cdn.shopify.com')||
        payload.cfpCards?.version!==1&&Object.keys(product).some(key=>key.startsWith('metafield_custom.')&&product[key]))continue;
      const base=value=>value.split('?')[0].replace(/^https?:/,'').toLowerCase();
      if(payload.cfpCards?.version!==1&&!product.variants?.some(variant=>typeof variant.imageUrl==='string'&&base(variant.imageUrl)===base(image)))continue;
      const resize=width=>{
        const clean=image.replace(/([?&])width=\d+/g,'$1').replace(/&+/g,'&').replace(/\?&/,'?');
        return clean+(clean.includes('?')?'&':'?')+'width='+width;
      };
      const link=document.createElement('link');link.rel='preload';link.as='image';link.fetchPriority='high';
      link.href=resize(360);link.imageSrcset=[180,360,540].map(width=>resize(width)+' '+width+'w').join(', ');
      link.imageSizes='(max-width: 480px) 50vw, (max-width: 900px) 33vw, 25vw';document.head.append(link);
    }
  }
  function cachedFirstRow(params,meta){
    // The full widget stores only complete, scoped first pages. Read the same
    // ten-minute entry before the widget downloads, then verify in the background.
    if(!meta||meta.dataset.customerLoggedIn!=='false'||meta.dataset.customerTags)return null;
    try{
      const keyParams=new URLSearchParams(params);keyParams.delete('responseProfile');keyParams.sort();
      const key='cfp:collection-result:v1:'+keyParams;
      const raw=sessionStorage.getItem(key);if(!raw)return null;
      const saved=JSON.parse(raw),age=Date.now()-saved.at;
      if(!Number.isFinite(age)||age<0||age>=10*60*1000||
        !/^[a-f0-9-]{36}$/.test(saved.rankingToken||'')||
        !Number.isSafeInteger(saved.totalCount)||saved.totalCount<=0||
        !Array.isArray(saved.products)||saved.products.length!==Math.min(25,saved.totalCount)||
        !saved.products.every(product=>product?.id&&product.handle&&product.title)){
        sessionStorage.removeItem(key);return null;
      }
      return {products:saved.products,totalCount:saved.totalCount,globalSettings:saved.globalSettings,
        cfpCards:{version:1,preview:false},debug:{collectionRankingStatus:'ready'}};
    }catch{return null;}
  }
  function start(){
      try {
        var meta=document.querySelector('meta[name="cfp-collection-context"]');
        // A preloaded extension asset can arrive before its Liquid metadata.
        // Start the public request then, but never display it until Liquid
        // confirms the market and customer scope. No merchant theme edits.
        var provisional=!meta;
        var handle=location.pathname.match(/\/collections\/([^/]+)/)?.[1];
        var context=meta?{shop:meta.dataset.shop,handle:meta.dataset.handle,country:meta.dataset.country,locale:meta.dataset.locale,customerTags:meta.dataset.customerTags||''}:
          {shop:window.Shopify?.shop,handle:handle&&decodeURIComponent(handle),country:window.Shopify?.country,locale:window.Shopify?.locale,customerTags:''};
        if(!context.shop||!context.country||!context.locale||!context.handle)return false;
        if(!provisional){
          window.cfpCollectionContext=context;
          if(typeof window.cfpCustomerTags==='undefined')window.cfpCustomerTags=context.customerTags;
        }
        var query = new URLSearchParams(location.search);
        if (query.has('page') && query.get('page') !== '1') return;
        if ([...query.keys()].some(function(key) {
          return !['page','sortBy','rankingToken','preview_theme_id','_ab','_fd','_sc','pb','gclid','fbclid'].includes(key) && !key.startsWith('utm_');
        })) return;
        var sort = query.get('sortBy') || 'best-selling';
        if (!['best-selling','bestselling'].includes(sort) || !context.country || !context.locale || !context.handle) return;
        var params = new URLSearchParams({shop:context.shop,collectionHandle:context.handle,country:context.country,locale:context.locale,sortBy:sort,page:'1',limit:'25'});
        if (context.customerTags) params.set('customer_tags',context.customerTags);
        params.set('responseProfile',context.customerTags ? 'collection-v1' : 'collection-preview-v1');
        params.sort();
        var url = 'https://aisearchfilter.webvory.com/api/filter?' + params;
        var previous = window._cfpRankedEarlyFetch;
        if (previous && previous.url === url) {
          if(!provisional){
            previous.verified=true;previous.context=context;
            // The inline body fetch can beat this loader when theme CSS delays
            // head scripts. Adopt its ready payload too, not only its identity.
            if(!previous.deliver)previous.deliver=function(result){
              if(!result||result.status!==200||previous.delivered&&!result.payload?.cfpCards?.streaming||previous.controller.signal.aborted||window._cfpRankedEarlyFetch!==previous)return;
              try{if(!previous.delivered)preloadImages(result.payload);previous.delivered=true;mountFirstRow(result.payload,previous.context,previous.controller);}catch{}
            };
            if(previous.partial)previous.deliver(previous.partial);
            previous.promise.then(previous.deliver);
          }
          return provisional?false:true;
        }
        previous?.controller.abort();
        var controller = new AbortController();
        var timer = setTimeout(function() {controller.abort();},30000);
        var entry={url:url,controller:controller,configurationPromise:null,verified:!provisional,context:context,delivered:false};
        if(!provisional){
          const cached=cachedFirstRow(params,meta);
          if(cached)try{mountFirstRow(cached,context,controller);}catch{}
        }
        entry.deliver=function(result){
          entry.partial=result;
          if(!result||result.status!==200||!entry.verified||entry.delivered&&!result.payload?.cfpCards?.streaming||controller.signal.aborted||window._cfpRankedEarlyFetch!==entry)return;
          try{if(!entry.delivered)preloadImages(result.payload);entry.delivered=true;mountFirstRow(result.payload,entry.context,controller);}catch{}
        };
        async function read(){
          while(!controller.signal.aborted){
            const response=await fetch(url,{signal:controller.signal,cache:'no-cache',priority:'high',headers:{Accept:window.cfpReadEarlyResponse?'application/x-ndjson, application/x-cfp-published-page-v1, application/x-cfp-pinned-prefix-v3, application/json':'application/x-cfp-published-page-v1, application/x-cfp-pinned-prefix-v3, application/json'}});
            const result=window.cfpReadEarlyResponse?await window.cfpReadEarlyResponse(response,entry.deliver):{status:response.status,payload:await response.json()};
            // Once the widget claims this request, its existing bounded retry
            // loop owns pending responses. Do not add another timeout window.
            if(response.status!==202||entry.claimed){entry.deliver(result);return result;}
            // Only pending rankings wait. Ready cards are delivered immediately,
            // even while the full widget is still downloading or executing.
            const seconds=Number(response.headers?.get('Retry-After'));
            const delay=Number.isFinite(seconds)&&seconds>0?Math.min(seconds*1000,1000):1000;
            await new Promise(resolve=>{
              const finish=()=>{clearTimeout(retry);controller.signal.removeEventListener('abort',finish);resolve();};
              const retry=setTimeout(finish,delay);controller.signal.addEventListener('abort',finish,{once:true});
              if(controller.signal.aborted)finish();
            });
          }
          return null;
        }
        window._cfpRankedEarlyFetch = entry;
        entry.promise=read()
            .catch(function() {return null;})
            .finally(function() {clearTimeout(timer);});
        if(provisional)return false;
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
  
