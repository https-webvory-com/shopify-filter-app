import {canonicalSize,isSizeFacet} from './facetNormalization.js';
const countryPattern=/^[A-Z]{2}$/;
const currencyPattern=/^[A-Z]{3}$/;
const id=value=>String(value).split('/').pop();

export function priceSortVariant(product,context){
 if(!context||!['asc','desc'].includes(context.direction))return null;
 const normalize=value=>String(value??'').trim().toLowerCase();
 const options=product.options||[],selected=context.options||{},merged=context.mergedValues||[];
 let result=null;
 for(const variant of product.variants||product.variantPrices||[]){
  if(context.stockOnly&&variant.available!==true)continue;
  const raw=context.basePrice?variant.price:variant.marketPrices?.[context.country]?.price;
  const currency=context.basePrice?context.currency:variant.marketPrices?.[context.country]?.currency;
  if(raw==null||raw===''||!Number.isFinite(Number(raw))||Number(raw)<0||!/^[A-Z]{3}$/.test(currency||''))continue;
  const price=Number(raw);
  if(context.ranges?.length&&!context.ranges.some(range=>price>=range.min&&(range.max==null||price<=range.max)))continue;
  if(!Object.entries(selected).every(([name,values])=>{
   if(!values?.length)return true;
   const position=options.findIndex(option=>normalize(option.name)===normalize(name));
   if(position<0)return false;
   const actual=normalize(variant['option'+(position+1)]);
   return values.some(value=>actual===normalize(value)||isSizeFacet(name)&&canonicalSize(actual)&&canonicalSize(actual)===canonicalSize(value)||merged.some(rule=>(!rule.optionName||normalize(rule.optionName)===normalize(name))&&normalize(rule.targetValue)===normalize(value)&&(rule.sourceValues||[]).some(source=>normalize(source)===actual)));
  }))continue;
  if(!result||(context.direction==='desc'?price>result.price:price<result.price)||price===result.price&&id(variant.id)<result.variantId)
   result={version:2,country:context.country,currency,variantId:id(variant.id),price};
 }
 return result;
}

export function savedMarketProduct(product,country,{basePrice=false}={}){
 const variants=product.variants||[];
 if(basePrice&&country==='US'&&variants.length&&variants.every(variant=>variant.price!=null&&variant.price!==''&&Number.isFinite(Number(variant.price))&&Number(variant.price)>=0)){
  const clean=variants.map(({marketPrices,...variant})=>variant),amounts=clean.map(variant=>Number(variant.price));
  return {...product,variants:clean,priceMin:Math.min(...amounts),priceMax:Math.max(...amounts),pricingContext:{country:'US',currency:'USD',source:'saved'}};
 }
 const prices=variants.map(variant=>variant.marketPrices?.[country]);
 const valid=countryPattern.test(country||'')&&variants.length>0&&prices.every(price=>price&&price.price!=null&&price.price!==''&&Number.isFinite(Number(price.price))&&Number(price.price)>=0&&currencyPattern.test(price.currency||'')&&price.currency===prices[0].currency);
 const clean=variants.map(({marketPrices,...variant},index)=>{
  if(!valid)return variant;
  const compare=prices[index].compareAtPrice;
  return {...variant,price:Number(prices[index].price),compareAtPrice:compare!=null&&compare!==''&&Number.isFinite(Number(compare))&&Number(compare)>=0?Number(compare):null};
 });
 if(!valid)return {...product,variants:clean};
 const amounts=clean.map(variant=>variant.price);
 return {...product,variants:clean,priceMin:Math.min(...amounts),priceMax:Math.max(...amounts),pricingContext:{country,currency:prices[0].currency,source:'saved'}};
}

// Canonical/background responses inspect only their visible page. This reads
// existing variant data; it never syncs products or updates an index.
export async function hydrateSavedMarketPrices(products,variantModel,shop,country){
 if(!countryPattern.test(country||'')||typeof variantModel?.findMany!=='function')return;
 if(!products.length)return;
 const ids=products.map(product=>'gid://shopify/Product/'+id(product.id));
 const rows=await variantModel.findMany({where:{productId:{in:ids},product:{shop}},select:{productId:true,id:true,marketPrices:true}});
 const byId=new Map(rows.map(row=>[id(row.id),row]));
 for(const product of products)for(const variant of product.variantPrices||[]){
  const stored=byId.get(id(variant.id));
  if(stored&&id(stored.productId)===id(product.id))variant.marketPrices={...(variant.marketPrices||{}),...(stored.marketPrices||{})};
 }
}
