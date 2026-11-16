// A single model/SKU code must not be expanded into semantic catalog matches.
export function isProductCodeQuery(value){
 if(typeof value!=='string')return false;
 const query=value.trim();
 if(query.length>128||!/^(?=[^\s]*\d)[a-z\d._/-]+(?: [a-z\d._/-]+)*$/i.test(query))return false;
 const tokens=query.split(' ');
 // Spaces can occur inside a SKU's color, such as 1517-Steel Blue-4.
 // A numbered shopping phrase has no model/variant delimiters around it.
 return tokens.length===1||(/[._/-]/.test(tokens[0])&&/[._/-]/.test(tokens[tokens.length-1]));
}

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
