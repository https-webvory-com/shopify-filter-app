import {DEFAULT_SEARCH_SETTINGS} from './searchSettings.js';

export const searchFieldName=index=>'cfp_field_'+String(index).padStart(3,'0');
export function searchIndexConfiguration(settings){
 const s=settings||DEFAULT_SEARCH_SETTINGS;
 return Object.fromEntries(['fields','stopwords','tokenDelimiters','tentativeDelimiters','hideUnavailableVariants','omitProductMetafields','omitProductMetaobjects','omitVariantMetafields','omitVariantMetaobjects','productDateType','smartSkuSearch'].map(key=>[key,key==='fields'?s.fields.map(f=>[f.key,f.weight,f.search,f.suggest,f.numeric,f.delimiter,f.transforms,f.indexTransforms,...(f.delimiters?.length?[f.delimiters]:[])]):s[key]]));
}
export const requiresCustomSearchIndex=settings=>JSON.stringify(searchIndexConfiguration(settings))!==JSON.stringify(searchIndexConfiguration(DEFAULT_SEARCH_SETTINGS));
export function transformSearchValue(value,rules=[]){
 let text=String(value??'');
 for(const rule of rules){
  if(rule.type==='trim')text=text.trim();
  else if(rule.type==='trim-start')text=text.trimStart();
  else if(rule.type==='trim-end')text=text.trimEnd();
  else if(rule.type==='lowercase')text=text.toLowerCase();
  else if(rule.type==='uppercase')text=text.toUpperCase();
  else if(rule.type==='strip-html')text=text.replace(/<[^>]*>/g,' ');
  else if(rule.type==='remove-prefix'&&text.startsWith(rule.value))text=text.slice(rule.value.length);
  else if(rule.type==='remove-suffix'&&text.endsWith(rule.value))text=text.slice(0,-rule.value.length);
  else if(rule.type==='replace'&&rule.value)text=text.split(rule.value).join(rule.replacement);
 }
 return text;
}
export function normalizeSearchTokens(value,settings){
 let text=String(value??'');
 for(const token of settings?.tentativeDelimiters||[]){const escaped=token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');text=text.replace(new RegExp('(?<=\\s)'+escaped+'|'+escaped+'(?=\\s)','gu'),' ');}
 return text;
}
export function enabledSearchFields(settings,kind='search'){
 return (settings?.fields||DEFAULT_SEARCH_SETTINGS.fields).map((field,index)=>({...field,index})).filter(f=>f[kind]&&f.weight>0).sort((a,b)=>b.weight-a.weight||a.index-b.index);
}
function sourceValues(doc,key,settings){
 const variants=settings.hideUnavailableVariants?(doc.variantPrices||[]).filter(v=>v.available):(doc.variantPrices||[]);
 if(key==='sku'||key==='barcode')return variants.map(v=>v[key]);
 if(key==='description')return [doc.description||doc._searchExtras?.description];
 if(key==='collections')return doc.collection_titles||[];
 if(key.startsWith('option:')){const name=key.slice(7);return (doc.options||[]).flatMap((o,index)=>name==='*'||o.name===name?(settings.hideUnavailableVariants?variants.map(v=>v['option'+(index+1)]).filter(Boolean):o.values||[]):[]);}
 if(key.startsWith('productMetafield:')){const name=key.slice(17);return Object.entries(doc).filter(([k])=>k.startsWith('metafield_')&&(name==='*'||k==='metafield_'+name)).flatMap(([,v])=>Array.isArray(v)?v:[v]);}
 if(key.startsWith('variantMetafield:')){const name=key.slice(17);return variants.flatMap(v=>Object.entries(v.searchMetafields||{}).filter(([k])=>name==='*'||k===name).flatMap(([,v])=>Array.isArray(v)?v:[v]));}
 const value=doc[key];return Array.isArray(value)?value:[value];
}
export function projectConfiguredSearchDocument(document,settings){
 const s=settings||DEFAULT_SEARCH_SETTINGS,doc={...document},semantic=[];
 for(const [index,field]of s.fields.entries()){
  let values=sourceValues(doc,field.key,s).filter(v=>v!=null).flatMap(value=>{
   const displayed=transformSearchValue(typeof value==='object'?JSON.stringify(value):value,field.transforms);
   const separators=[...new Set([field.delimiter,...(field.delimiters||[])].filter(Boolean))].sort((a,b)=>b.length-a.length);
   return separators.length?displayed.split(new RegExp(separators.map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'u')):[displayed];
  }).map(value=>normalizeSearchTokens(transformSearchValue(value,field.indexTransforms),s)).filter(v=>v!=='');
  if(field.numeric)values=values.map(Number).filter(Number.isFinite);
  doc[searchFieldName(index)]=[...new Set(values)];
  if(field.search&&field.weight>0)semantic.push(field.label+': '+values.join(', '));
 }
 doc.cfpSemanticText=semantic.join('. ').slice(0,12000);
 doc.cfpSkuNormalized=(s.hideUnavailableVariants?(doc.variantPrices||[]).filter(v=>v.available):doc.variantPrices||[]).map(v=>String(v.sku||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')).filter(Boolean);
 const date={created:doc._searchExtras?.createdAt,published:doc._searchExtras?.publishedAt,updated:doc._searchExtras?.updatedAt}[s.productDateType];
 if(date&&Number.isFinite(new Date(date).getTime()))doc.createdAt=new Date(date).getTime();
 if(s.omitProductMetafields)for(const key of Object.keys(doc))if(key.startsWith('metafield_')&&!s.fields.some(f=>f.key==='productMetafield:'+key.slice(9)))delete doc[key];
 delete doc._searchExtras;
 return doc;
}
export function configuredSearchOptions(query,settings,{kind='search'}={}){
 if(!settings)return query;
 const fields=enabledSearchFields(settings,kind).map(f=>searchFieldName(f.index));
 const q=normalizeSearchTokens(query.q,settings);
 return {...query,q,attributesToSearchOn:fields.length?fields:['cfp_no_search_fields'],matchingStrategy:settings.broadMatch?'last':'all'};
}
export function publicSearchProduct(product,settings){
 if(!settings)return product;
 const result={...product};
 for(const field of settings.fields)if(['title','vendor','productType'].includes(field.key))result[field.key]=transformSearchValue(result[field.key],field.transforms);
 if(Array.isArray(result.variantPrices))result.variantPrices=result.variantPrices.map(({searchMetafields,...variant})=>variant);
 if(Array.isArray(result.variants))result.variants=result.variants.map(({searchMetafields,...variant})=>variant);
 for(const key of Object.keys(result))if(key.startsWith('cfp_field_')||['cfpSemanticText','cfpSkuNormalized'].includes(key)||(key.startsWith('metafield_')&&settings.returnedMetafields.length&&!settings.returnedMetafields.includes(key.slice(9))))delete result[key];
 return result;
}
