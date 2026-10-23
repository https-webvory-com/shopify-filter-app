const grams={GRAMS:1,KILOGRAMS:1000,OUNCES:28.349523125,POUNDS:453.59237};
export function weightInGrams(weight) {
  const value=Number(weight?.value),factor=grams[weight?.unit];
  return weight?.value!=null&&Number.isFinite(value)&&value>=0&&factor?value*factor:null;
}
async function query(admin,source,variables) {
  const response=await(await admin.graphql(source,{variables})).json();
  if(response.errors||!response.data)throw Error('Could not synchronize product filter data');
  return response.data;
}
const variantFields=`id sku price compareAtPrice inventoryQuantity availableForSale image { url } selectedOptions { name value } inventoryItem { id measurement { weight { value unit } } }`;
export async function hydrateProductFilterFacts(product,admin,database,shop) {
  // The explicit rating lookup remains complete even beyond the general
  // metafield connection's first page, and preserves an explicit deletion.
  if(Object.hasOwn(product,'ratingMetafield')){
    product.metafields ||= {nodes:[]};product.metafields.nodes ||= [];
    product.metafields.nodes=product.metafields.nodes.filter(m=>!(m.namespace==='reviews'&&m.key==='rating'));
    if(product.ratingMetafield)product.metafields.nodes.push(product.ratingMetafield);
  }
  if(!product.variants?.nodes?.length)return;
  const variants=product.variants.nodes;
  let page=product.variants.pageInfo;
  const cursors=new Set();
  while(page?.hasNextPage) {
    if(!page.endCursor||cursors.has(page.endCursor))throw Error('Product variant pagination stalled');
    cursors.add(page.endCursor);
    const data=await query(admin,`query FilterVariants($id:ID!,$after:String){ product(id:$id){ variants(first:100,after:$after){ pageInfo {hasNextPage endCursor} nodes {${variantFields}} } } }`,{id:product.id,after:page.endCursor});
    const connection=data.product?.variants;
    if(!connection?.nodes?.length)throw Error('Incomplete product variants');
    const priorIds=new Set(variants.map(v=>v.id));if(connection.nodes.some(v=>!v.id||priorIds.has(v.id)))throw Error('Product variant pagination repeated a variant');
    variants.push(...connection.nodes);page=connection.pageInfo;
  }
  const missing=variants.filter(v=>v.inventoryItem===undefined&&String(v.id).startsWith('gid://shopify/ProductVariant/'));
  for(let offset=0;offset<missing.length;offset+=50){
    const batch=missing.slice(offset,offset+50);
    const data=await query(admin,`query FilterVariantMeasurements($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{id inventoryItem{id measurement{weight{value unit}}}}}}`,{ids:batch.map(v=>v.id)});
    if(!Array.isArray(data.nodes)||data.nodes.length!==batch.length||data.nodes.some(v=>!v))throw Error('Incomplete product weight data');
    const byId=new Map(data.nodes.map(v=>[v.id,v]));
    for(const variant of batch){if(!byId.has(variant.id))throw Error('Mismatched product weight data');variant.inventoryItem=byId.get(variant.id).inventoryItem;}
  }
  if(!variants.some(v=>v.inventoryItem))return;
  if(page)product.variants.pageInfo=page;
  const wantsLocations=await database.filterGroupItem.findFirst({where:{isEnabled:true,filterType:'inventory_locations',filterGroup:{shop}},select:{id:true}});
  const locations=new Map();
  if(wantsLocations){
    const items=[...new Set(variants.map(v=>v.inventoryItem?.id).filter(Boolean))];
    const fields=`id inventoryLevels(first:10){pageInfo {hasNextPage endCursor} nodes { location {id name} quantities(names:["available"]) {name quantity} }}`;
    for(let offset=0;offset<items.length;offset+=20){
      const ids=items.slice(offset,offset+20);
      const data=await query(admin,`query FilterInventory($ids:[ID!]!){nodes(ids:$ids){... on InventoryItem {${fields}}}}`,{ids});
      if(!Array.isArray(data.nodes)||data.nodes.length!==ids.length||data.nodes.some(v=>!v))throw Error('Incomplete inventory filter data');
      for(const item of data.nodes){
        let connection=item.inventoryLevels;const seen=new Set();
        while(connection){
          for(const level of connection.nodes||[])if(level.quantities?.some(q=>q.name==='available'&&q.quantity>0)&&level.location)locations.set(level.location.id,{id:level.location.id,label:level.location.name});
          if(!connection.pageInfo?.hasNextPage)break;
          const after=connection.pageInfo.endCursor;
          if(!after||seen.has(after))throw Error('Inventory location pagination stalled');
          seen.add(after);
          const next=await query(admin,`query FilterInventoryPage($id:ID!,$after:String){inventoryItem(id:$id){inventoryLevels(first:50,after:$after){pageInfo{hasNextPage endCursor} nodes{location{id name} quantities(names:["available"]){name quantity}}}}}`,{id:item.id,after});
          connection=next.inventoryItem?.inventoryLevels;if(!connection)throw Error('Incomplete inventory locations');
        }
      }
    }
  }
  const facts={version:1,weights:[...new Set(variants.map(v=>weightInGrams(v.inventoryItem?.measurement?.weight)).filter(v=>v!=null))],locations:wantsLocations?[...locations.values()]:[]};
  product.metafields ||= {nodes:[]};product.metafields.nodes ||= [];
  product.metafields.nodes=product.metafields.nodes.filter(m=>!(m.namespace==='__cfp_internal'&&m.key==='filter_facts'));
  product.metafields.nodes.push({id:`cfp-filter-facts:${product.id}`,namespace:'__cfp_internal',key:'filter_facts',type:'json',value:JSON.stringify(facts)});
}

export function productFilterFactsValue(product) {
  const fields=Array.isArray(product.metafields)?product.metafields:product.metafields?.nodes||[];
  const raw=fields.find(m=>m.namespace==='__cfp_internal'&&m.key==='filter_facts')?.value;
  try{return raw?JSON.parse(raw):null;}catch{return null;}
}
