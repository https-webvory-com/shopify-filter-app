// Short, atomic country-only persistence. The Shopify read happens beforehand.
export async function saveProductMarketPrices(db,before,prices,country){
 await db.$transaction(async tx=>{
  const claimed=await tx.product.updateMany({where:{id:before.id,shop:before.shop,updatedAt:before.updatedAt},data:{updatedAt:new Date()}});
  if(claimed.count!==1)throw Error('Product changed during country price read; retry');
  const current=await tx.variant.findMany({where:{productId:before.id},select:{id:true,marketPrices:true}});
  const original=new Map(before.variants.map(v=>[v.id,v.marketPrices?.[country]]));
  if(current.length!==before.variants.length||current.some(v=>!original.has(v.id)||JSON.stringify(v.marketPrices?.[country])!==JSON.stringify(original.get(v.id))))throw Error('Variant prices changed during country price read; retry');
  const payload=JSON.stringify(prices);
  const count=await tx.$executeRaw`UPDATE "Variant" AS v SET "marketPrices" = jsonb_set(COALESCE(v."marketPrices", '{}'::jsonb), ARRAY[${country}]::text[], p.price, true)
    FROM jsonb_to_recordset(${payload}::jsonb) AS p(id text, price jsonb)
    WHERE v.id = p.id AND v."productId" = ${before.id}`;
  if(count!==prices.length)throw Error('Incomplete country price save; retry');
 },{isolationLevel:'Serializable',timeout:15000});
}
