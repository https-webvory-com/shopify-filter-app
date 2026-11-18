const countryPattern=/^[A-Z]{2}$/;
const currencyPattern=/^[A-Z]{3}$/;
const id=value=>String(value).split('/').pop();

export function savedMarketProduct(product,country){
 const variants=product.variants||[];
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
