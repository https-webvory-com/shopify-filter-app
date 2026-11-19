import {createHash} from 'node:crypto';
import {normalizeManualFacetFilter,normalizeManualFacetConfig} from './manualFacetValues.js';

export function collectionConfiguration(payload) {
  const configuration = JSON.parse(JSON.stringify({settings:(payload.settings || []).map(normalizeManualFacetFilter), mergedValues:payload.mergedValues || [], globalSettings:payload.globalSettings || {}}));
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
// identical to the sidebar, including exclusions and manual allow-lists. The
// sidebar still owns display transformations and each group's saved ordering.
// Unknown/malformed filter definitions retain the original facets.
export function visibleCollectionFacets(facets, settings) {
  if (!facets || !Array.isArray(settings)) return facets;
  const result={}, consumers={tags:[],collections:[]};
  const names={vendor:'vendors',product_type:'productTypes',collection:'collections',tag:'tags',tags:'tags',title:'titles',price:'priceRanges',percent_sale:'percentSale',weight:'extraFilters',review_rating:'extraFilters',inventory_locations:'extraFilters',availability:'availability',stock_status:'availability'};
  for (const setting of settings) {
    if (!setting.isEnabled) continue;
    const type=setting.filterType || setting.type, key=setting.filterKey || setting.key;
    if (type==='option' || type==='metafield') {
      if (!key) return facets;
      const name=type==='option'?'options':'metafields';
      if (Object.hasOwn(facets[name] || {},key)) result[name]={...(result[name] || {}),[key]:facets[name][key]};
    } else {
      const name=Object.hasOwn(names,type)?names[type]:null;if (!name) return facets;
      if(type==='stock_status'&&facets.extraFilters)result.extraFilters=facets.extraFilters;
      if (Object.hasOwn(facets,name)) result[name]=facets[name];
      if (name in consumers) {
        let config;
        try {config=normalizeManualFacetConfig(setting.config);} catch {return facets;}
        if (config.prefix && typeof config.prefix!=='string') return facets;
        if (config.excludedValues && !Array.isArray(config.excludedValues)) return facets;
        if (config.manualValuesInvalid) return facets;
        const prefix=(config.prefix || '').toLowerCase(), manualPrefix=prefix.trim();
        const manual=config.useManualValues && config.manualValues?.length ? config.manualValues.map(value=>value.toLowerCase().trim()) : null;
        consumers[name].push(item=>{
          const raw=item.value || '';
          if (typeof raw!=='string') return true;
          if (prefix && !raw.toLowerCase().startsWith(prefix)) return false;
          if (config.excludedValues?.includes(item.value)) return false;
          if (!manual) return true;
          const value=raw.toLowerCase().trim();
          const stripped=manualPrefix && value.startsWith(manualPrefix)?value.slice(manualPrefix.length).trim():value;
          return manual.includes(value) || manual.includes(stripped);
        });
      }
    }
  }
  for (const [name,filters] of Object.entries(consumers)) if (Array.isArray(result[name]) && filters.length)
    result[name]=result[name].filter(item=>filters.some(accept=>accept(item)));
  return result;
}
