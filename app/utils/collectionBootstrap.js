import {createHash} from 'node:crypto';

export function collectionConfiguration(payload) {
  const configuration = JSON.parse(JSON.stringify({settings:payload.settings || [], mergedValues:payload.mergedValues || [], globalSettings:payload.globalSettings || {}}));
  const version = createHash('sha256').update(JSON.stringify(configuration)).digest('hex');
  return {configuration, version};
}

export function configurationResponse(request, payload) {
  const {configuration,version} = collectionConfiguration(payload), etag = '"'+version+'"';
  const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-cache, must-revalidate','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'ETag',ETag:etag};
  const matches = request.headers.get('If-None-Match')?.split(',').some(value=>value.trim().replace(/^W\//,'')===etag);
  return new Response(matches ? null : JSON.stringify({configuration,configurationVersion:version}), {status:matches?304:200,headers});
}

// Keep complete values/counts for every enabled consumer. Prefix filtering is
// identical to the sidebar; manual values, exclusions and sorting stay there.
// Unknown/malformed filter definitions retain the original facets.
export function visibleCollectionFacets(facets, settings) {
  if (!facets || !Array.isArray(settings)) return facets;
  const result={}, prefixes={tags:[],collections:[]};
  const names={vendor:'vendors',product_type:'productTypes',collection:'collections',tag:'tags',tags:'tags',title:'titles',price:'priceRanges',availability:'availability',stock_status:'availability'};
  for (const setting of settings) {
    if (!setting.isEnabled) continue;
    const type=setting.filterType || setting.type, key=setting.filterKey || setting.key;
    if (type==='option' || type==='metafield') {
      if (!key) return facets;
      const name=type==='option'?'options':'metafields';
      if (Object.hasOwn(facets[name] || {},key)) result[name]={...(result[name] || {}),[key]:facets[name][key]};
    } else {
      const name=Object.hasOwn(names,type)?names[type]:null;if (!name) return facets;
      if (Object.hasOwn(facets,name)) result[name]=facets[name];
      if (name in prefixes) {
        let config;
        try {config=typeof setting.config==='string'?JSON.parse(setting.config):(setting.config || {});} catch {return facets;}
        if (config.prefix && typeof config.prefix!=='string') return facets;
        prefixes[name].push((config.prefix || '').toLowerCase());
      }
    }
  }
  for (const [name,values] of Object.entries(prefixes)) if (Array.isArray(result[name]) && values.length && !values.includes(''))
    result[name]=result[name].filter(item=>values.some(prefix=>String(item.value || '').toLowerCase().startsWith(prefix)));
  return result;
}
