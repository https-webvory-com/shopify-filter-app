// A single model/SKU code must not be expanded into semantic catalog matches.
export const isProductCodeQuery=value=>typeof value==='string'&&value.trim().length<=128&&/^(?=[^\s]*\d)[a-z\d._/-]+(?: [a-z\d._/-]+)*$/i.test(value.trim());

export function productMatchesCode(product,query){
 const value=query.trim().toLowerCase(),boundary=new RegExp('(^|[^a-z0-9])'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^a-z0-9])','i');
 return [product.title,product.handle].some(text=>boundary.test(String(text||'')))||(product.variants||product.variantPrices||[]).some(v=>{
  const sku=String(v.sku||'').trim().toLowerCase();return sku===value||['-','_','/',' '].some(separator=>sku.startsWith(value+separator));
 });
}

export function skuSearchWhere(shop,query){
 const value=query.trim();
 const literal=value=>value.replace(/[\\%_]/g,'\\$&');
 return {shop,status:{equals:'active',mode:'insensitive'},variants:{some:{OR:[
  {sku:{equals:value,mode:'insensitive'}},
  ...['-','_','/',' '].map(separator=>({sku:{startsWith:literal(value+separator),mode:'insensitive'}})),
 ]}}};
}
