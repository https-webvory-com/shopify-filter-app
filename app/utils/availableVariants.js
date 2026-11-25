import {Prisma} from '@prisma/client';
import {isSizeFacet,expandMappedFacetValues} from './facetNormalization.js';
import {compileVariantOptionMatcher} from './variantOptionMatcher.js';
export {availableOptionFacetCounts,availableOptionFacetSignature} from './availableOptionFacetCounts.js';
export {collectionPriceCandidateIds,savedPriceCollectionScope} from './collectionPriceCandidates.js';

const normalize = value => String(value ?? '').trim().toLowerCase();
const trimCharacters='\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

function selectedVariantValues(name,values,mergedValues){
 const expanded=new Set(values.map(normalize));
 if(isSizeFacet(name))for(const value of values)for(const alias of expandMappedFacetValues(name,value,mergedValues))expanded.add(normalize(alias));
 for(const rule of mergedValues||[])if((!rule.optionName||normalize(rule.optionName)===normalize(name))&&values.some(value=>normalize(value)===normalize(rule.targetValue)))
  for(const value of rule.sourceValues||[])expanded.add(normalize(value));
 return [...expanded];
}

// The public route's scope is deliberately small. Unknown caller predicates
// keep the generic Prisma path rather than silently losing a restriction.
async function availableProductIdsInDatabase(database,where,filters,mergedValues,priceRange,priceContext={},sortPage=null,splitRanges=null){
 if(!database?.$queryRaw||typeof where.shop!=='string'||Object.keys(where).some(key=>!['shop','status','collections','id'].includes(key)))return null;
 const clauses=[Prisma.sql`p."shop" = ${where.shop}`];
 if(where.id){
  if(Object.keys(where.id).some(key=>!['in','notIn'].includes(key)))return null;
  for(const key of ['in','notIn'])if(where.id[key]){
   if(!Array.isArray(where.id[key])||where.id[key].some(id=>typeof id!=='string'))return null;
   clauses.push(key==='in'?Prisma.sql`p."id" = ANY(${where.id[key]}::text[])`:Prisma.sql`NOT (p."id" = ANY(${where.id[key]}::text[]))`);
  }
 }
 if(where.status!==undefined){
  if(typeof where.status==='string')clauses.push(Prisma.sql`p."status" = ${where.status}`);
  else if(where.status&&Object.keys(where.status).every(key=>['equals','mode'].includes(key))&&typeof where.status.equals==='string'&&where.status.mode==='insensitive')clauses.push(Prisma.sql`lower(p."status") = ${where.status.equals.toLowerCase()}`);
  else return null;
 }
 if(where.collections!==undefined){
  const scope=where.collections;
  if(!scope||Object.keys(scope).length!==1||!scope.some||Object.keys(scope.some).length!==1||typeof scope.some.collectionId!=='string')return null;
  clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM "ProductCollection" pc WHERE pc."productId" = p."id" AND pc."collectionId" = ${scope.some.collectionId})`);
 }
 const variants=[Prisma.sql`v."productId" = p."id"`];
 if(priceContext.stockOnly!==false)variants.push(Prisma.sql`v."available" = true`);
 let amount=Prisma.sql`v."price"`,currency=Prisma.sql`${priceContext.currency||'USD'}::text`,compareAt=Prisma.sql`v."compareAtPrice"`;
 if(priceContext.country&&!priceContext.basePrice){
   if(!/^[A-Z]{2}$/.test(priceContext.country))return null;
   const savedPrice=Prisma.sql`v."marketPrices" -> ${priceContext.country} -> 'price'`;
   amount=Prisma.sql`CASE WHEN (v."marketPrices" -> ${priceContext.country} ->> 'currency') ~ '^[A-Z]{3}$' THEN
    CASE WHEN jsonb_typeof(${savedPrice})='number' THEN CASE WHEN (${savedPrice})::numeric >= 0 THEN (${savedPrice})::numeric ELSE NULL END
     WHEN jsonb_typeof(${savedPrice})='string' AND (v."marketPrices" -> ${priceContext.country} ->> 'price') ~ '^[0-9]+([.][0-9]+)?$' THEN (v."marketPrices" -> ${priceContext.country} ->> 'price')::numeric ELSE NULL END
    ELSE NULL END`;
   currency=Prisma.sql`v."marketPrices" -> ${priceContext.country} ->> 'currency'`;
   compareAt=Prisma.sql`CASE WHEN (v."marketPrices" -> ${priceContext.country} ->> 'compareAtPrice') ~ '^[0-9]+([.][0-9]+)?$' THEN (v."marketPrices" -> ${priceContext.country} ->> 'compareAtPrice')::numeric ELSE NULL END`;
 }
 const effectiveRanges=priceRange?(Array.isArray(priceRange)?priceRange:[priceRange]):priceContext.ranges||[];
 if(priceContext.currency&&!priceContext.basePrice)variants.push(Prisma.sql`${currency} = ${priceContext.currency}`);
 if(priceContext.requirePrice&&!effectiveRanges.length)variants.push(Prisma.sql`(${amount} IS NOT NULL AND ${amount} >= 0)`);
 if(effectiveRanges.length){
  const ranges=effectiveRanges,predicates=[];
  for(const range of ranges){
   if(!Number.isFinite(range.min)||(range.max!==Infinity&&range.max!==null&&!Number.isFinite(range.max)))return null;
   predicates.push(Prisma.sql`(${amount} >= ${range.min}${Number.isFinite(range.max)?Prisma.sql` AND ${amount} <= ${range.max}`:Prisma.empty})`);
  }
  if(predicates.length)variants.push(Prisma.sql`(${Prisma.join(predicates,' OR ')})`);
 }
 const optionPositions=[];
 function optionValue(names){
  const lookup=Prisma.sql`FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p."options") = 'array' THEN p."options" ELSE '[]'::jsonb END) WITH ORDINALITY AS opt(value, position)
   WHERE lower(btrim(coalesce(opt.value->>'name', ''), ${trimCharacters})) IN (${Prisma.join(names)})
   ORDER BY opt.position LIMIT 1`;
  if(sortPage)return Prisma.sql`(
   SELECT CASE opt.position
    WHEN 1 THEN lower(btrim(coalesce(v."option1", ''), ${trimCharacters}))
    WHEN 2 THEN lower(btrim(coalesce(v."option2", ''), ${trimCharacters}))
    WHEN 3 THEN lower(btrim(coalesce(v."option3", ''), ${trimCharacters}))
    ELSE '' END ${lookup}
  )`;
  // Resolve the option name once per scoped product, rather than walking the
  // same JSON option list again for each candidate variant in the EXISTS read.
  const name='cfpOptionPosition'+optionPositions.length,position=Prisma.raw(`p."${name}"`);
  optionPositions.push(Prisma.sql`(SELECT opt.position ${lookup}) AS ${Prisma.raw(`"${name}"`)}`);
  return Prisma.sql`CASE ${position}
   WHEN 1 THEN lower(btrim(coalesce(v."option1", ''), ${trimCharacters}))
   WHEN 2 THEN lower(btrim(coalesce(v."option2", ''), ${trimCharacters}))
   WHEN 3 THEN lower(btrim(coalesce(v."option3", ''), ${trimCharacters}))
   ELSE CASE WHEN ${position} IS NULL THEN NULL ELSE '' END END`;
 }
 for(const [name,values]of Object.entries(filters||{}))if(values.length){
  const expanded=selectedVariantValues(name,values,mergedValues),key=normalize(name);
  // Match option names at their actual position. All predicates refer to this
  // same available variant, including price, aliases and empty option values.
  variants.push(Prisma.sql`(${optionValue([key])}) IN (${Prisma.join(expanded)})`);
 }
 if(priceContext.searchColorValues){
  const values=priceContext.searchColorValues.map(normalize);
  if(!values.length)return [];
  // Search intent is already resolved to exact catalog colors. Do not expand
  // it through broader merchant aliases a second time. This predicate shares
  // the same v row as explicit size/color/price restrictions.
  variants.push(Prisma.sql`(${optionValue(['color','colour'])}) IN (${Prisma.join(values)})`);
 }
 if(sortPage){
  const direction=priceContext.direction==='desc'?Prisma.sql`DESC`:Prisma.sql`ASC`;
  const bound=priceContext.direction==='desc'?Prisma.sql`MAX(${amount})`:Prisma.sql`MIN(${amount})`;
  if(!priceContext.country||priceContext.basePrice)variants.push(Prisma.sql`v."price" >= 0`);
  const query=sortPage.compact?Prisma.sql`
   WITH priced AS MATERIALIZED (
    SELECT p."id", v."id" AS "selectedVariantId", ${amount} AS price, ${currency} AS currency
    FROM "Product" p JOIN "Variant" v ON v."productId"=p."id"
    WHERE ${Prisma.join([...clauses,...variants],' AND ')}
   )
   SELECT DISTINCT ON ("id") * FROM priced WHERE price>=0
   ORDER BY "id", price ${direction}, "selectedVariantId" ASC
  `:Prisma.sql`
   WITH matches AS MATERIALIZED (
    SELECT p."id", ${bound} AS price
    FROM "Product" p JOIN "Variant" v ON v."productId"=p."id"
    WHERE ${Prisma.join([...clauses,...variants],' AND ')}
    GROUP BY p."id" HAVING ${bound} IS NOT NULL
   ), page AS (
    SELECT * FROM matches ORDER BY price ${direction}, "id" ASC LIMIT ${sortPage.limit} OFFSET ${sortPage.offset}
   )
   SELECT page.*, selected."selectedVariantId", selected.currency, total.total, details.variants
   FROM (SELECT COUNT(*) AS total FROM matches) total LEFT JOIN page ON true
   LEFT JOIN "Product" p ON p."id"=page."id"
   LEFT JOIN LATERAL (
    SELECT v."id" AS "selectedVariantId", ${currency} AS currency FROM "Variant" v
    WHERE ${Prisma.join(variants,' AND ')} AND ${amount}=page.price ORDER BY v."id" ASC LIMIT 1
   ) selected ON true
   LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('id',v."id",'price',v."price",'compareAtPrice',v."compareAtPrice",'available',v."available",'option1',v."option1",'option2',v."option2",'option3',v."option3",'sku',v."sku",'imageUrl',v."imageUrl",
      'marketPrices',jsonb_build_object(${priceContext.country},jsonb_build_object('price',${amount},'currency',${currency},'compareAtPrice',${compareAt}))) ORDER BY v."id") AS variants
    FROM "Variant" v WHERE v."productId"=page."id"
   ) details ON true
   ORDER BY page.price ${direction}, page."id" ASC
  `;
  // These small paginated reads should not pay PostgreSQL's compilation cost
  // for repeated JSON price expressions. The setting ends with this read.
  if(typeof database.$transaction==='function')return database.$transaction(async transaction=>{
   await transaction.$executeRaw`SET LOCAL jit = off`;
   return transaction.$queryRaw(query);
  },{timeout:10000});
  return database.$queryRaw(query);
 }
 if(splitRanges){
  // One pass over the matching variants decides every band at once. Each
  // band still requires the SAME variant to satisfy price and all options.
  const flags=[];
  for(const range of splitRanges){
   if(!Number.isFinite(range.min)||(range.max!==Infinity&&range.max!==null&&!Number.isFinite(range.max)))return null;
   flags.push(Prisma.sql`bool_or(${amount} >= ${range.min}${Number.isFinite(range.max)?Prisma.sql` AND ${amount} <= ${range.max}`:Prisma.empty}) AS ${Prisma.raw(`"r${flags.length}"`)}`);
  }
  if(!flags.length)return [];
  const source=optionPositions.length?Prisma.sql`(SELECT p."id", ${Prisma.join(optionPositions)} FROM "Product" p WHERE ${Prisma.join(clauses,' AND ')})`:Prisma.sql`(SELECT p."id" FROM "Product" p WHERE ${Prisma.join(clauses,' AND ')})`;
  const query=Prisma.sql`WITH scoped_products AS MATERIALIZED ${source}
   SELECT p."id", ${Prisma.join(flags)} FROM scoped_products p JOIN "Variant" v ON ${Prisma.join(variants,' AND ')}
   GROUP BY p."id" ORDER BY p."id"`;
  const rows=typeof database.$transaction==='function'
   ?await database.$transaction(async transaction=>{await transaction.$executeRaw`SET LOCAL jit = off`;return transaction.$queryRaw(query);},{timeout:10000})
   :await database.$queryRaw(query);
  return splitRanges.map((_,i)=>rows.filter(row=>row['r'+i]===true).map(row=>row.id.split('/').pop()));
 }
 const membership=Prisma.sql`EXISTS (SELECT 1 FROM "Variant" v WHERE ${Prisma.join(variants,' AND ')})`;
 const query=optionPositions.length?Prisma.sql`
  WITH scoped_products AS MATERIALIZED (
   SELECT p."id", ${Prisma.join(optionPositions)} FROM "Product" p WHERE ${Prisma.join(clauses,' AND ')}
  ) SELECT p."id" FROM scoped_products p WHERE ${membership} ORDER BY p."id"`
  :Prisma.sql`SELECT p."id" FROM "Product" p WHERE ${Prisma.join([...clauses,membership],' AND ')} ORDER BY p."id"`;
 // Like saved-price pages, these interactive eligibility reads must not spend
 // their latency budget compiling JSON/option expressions. The setting is
 // confined to this read and never changes the database or pooled session.
 const rows=optionPositions.length&&typeof database.$transaction==='function'
  ?await database.$transaction(async transaction=>{
    await transaction.$executeRaw`SET LOCAL jit = off`;
    return transaction.$queryRaw(query);
   },{timeout:10000})
  :await database.$queryRaw(query);
 return rows.map(row=>row.id.split('/').pop());
}

export async function savedVariantPricePage(database,{shop,ids,collectionId,excludeIds=[],context,page=1,limit=25}){
 if(typeof shop!=='string'||(ids!=null?(!Array.isArray(ids)||ids.length>100000):!(collectionId==='all'||/^gid:\/\/shopify\/Collection\/\d+$/.test(collectionId||'')))||!Array.isArray(excludeIds)||excludeIds.some(id=>!/^\d+$/.test(String(id)))||!context||!['asc','desc'].includes(context.direction)||!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Invalid saved variant sort page');
 const where={shop,status:{equals:'active',mode:'insensitive'},...(collectionId&&collectionId!=='all'?{collections:{some:{collectionId}}}:{})};
 if(ids!=null||excludeIds.length)where.id={...(ids!=null?{in:ids.map(id=>'gid://shopify/Product/'+String(id).split('/').pop())}:{}),...(excludeIds.length?{notIn:excludeIds.map(id=>'gid://shopify/Product/'+id)}:{})};
 const rows=await availableProductIdsInDatabase(database,where,context.options||{},context.mergedValues||[],context.ranges?.length?context.ranges:null,context,{limit,offset:(page-1)*limit});
 if(!Array.isArray(rows))throw Error('Saved price query unavailable');
 const total=Number(rows[0]?.total||0);
 if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid saved price total');
 return {total,rows:rows.filter(row=>row.id).map(row=>({id:String(row.id).split('/').pop(),variants:row.variants,selection:{version:2,country:context.country,currency:row.currency,variantId:String(row.selectedVariantId).split('/').pop(),price:Number(row.price)}}))};
}

// The merchandising ranker needs only each candidate's selected price and ID.
// Keep full variant arrays confined to the visible storefront page.
export async function savedVariantPriceSelections(database,{shop,ids,context}){
 if(typeof shop!=='string'||!Array.isArray(ids)||ids.length>100000||!context||!['asc','desc'].includes(context.direction))throw Error('Invalid saved variant selections');
 const rows=await availableProductIdsInDatabase(database,{shop,status:{equals:'active',mode:'insensitive'},id:{in:ids.map(id=>'gid://shopify/Product/'+String(id).split('/').pop())}},context.options||{},context.mergedValues||[],context.ranges?.length?context.ranges:null,context,{limit:100000,offset:0,compact:true});
 if(!Array.isArray(rows))throw Error('Saved variant selections unavailable');
 return new Map(rows.filter(row=>row.id).map(row=>[String(row.id).split('/').pop(),{version:2,country:context.country,currency:row.currency,variantId:String(row.selectedVariantId).split('/').pop(),price:Number(row.price)}]));
}

export async function ensureVariantEligibilityFilter(index, tasks) {
  const attributes = await index.getFilterableAttributes();
  if (attributes.includes('id')) return;
  const task = await index.updateFilterableAttributes([...attributes, 'id']);
  const completed = await tasks.waitForTask(task.taskUid, {timeout: 120000});
  if (completed.status !== 'succeeded') throw new Error('Variant availability filter could not be prepared');
}

// OR within an option; AND across options, on the same available variant.
export function matchingAvailableVariants(product, filters = {}, mergedValues = [], priceRange = null,priceContext={}) {
  const matchesOptions=compileVariantOptionMatcher(product.options,filters,mergedValues);
  const searchColorPosition=priceContext.searchColorValues?(product.options||[]).findIndex(option=>/^colou?r$/i.test(String(option.name||'').trim())):-1;
  const searchColors=priceContext.searchColorValues?new Set(priceContext.searchColorValues.map(normalize)):null;
  const ranges=priceRange?(Array.isArray(priceRange)?priceRange:[priceRange]):priceContext.ranges||[];
  return (product.variants || product.variantPrices || []).filter(variant => {
    if (priceContext.stockOnly!==false&&variant.available !== true) return false;
    if(priceContext.searchColorValues){
      if(searchColorPosition<0||!searchColors.has(normalize(variant[`option${searchColorPosition+1}`])))return false;
    }
    if (ranges.length || priceContext.requirePrice) {
      const raw=priceContext.country&&!priceContext.basePrice?variant.marketPrices?.[priceContext.country]?.price:variant.price;
      const price = raw == null||raw==='' ? NaN : Number(raw);
      const currency=priceContext.country&&!priceContext.basePrice?variant.marketPrices?.[priceContext.country]?.currency:priceContext.currency;
      if (!Number.isFinite(price) || price < 0 || priceContext.requirePrice&&!/^[A-Z]{3}$/.test(currency||'')) return false;
      if(priceContext.currency&&currency!==priceContext.currency)return false;
      if (ranges.length&&!ranges.some(range=>price>=range.min&&(range.max==null||price<=range.max)))return false;
    }
    return matchesOptions(variant);
  });
}

// Exact per-band product IDs from one database pass. Returns null when the
// database path cannot express the request, so callers keep their fallback.
export async function availableProductIdsByPriceRanges(database,where,filters,mergedValues,ranges,{priceContext={}}={}){
 if(!database||!Array.isArray(ranges)||!ranges.length)return null;
 if(priceContext.searchColorValues&&!priceContext.searchColorValues.length)return ranges.map(()=>[]);
 if(priceContext.ranges?.length)return null;
 try{return await availableProductIdsInDatabase(database,where,filters,mergedValues,null,priceContext,null,ranges);}catch{return null;}
}

export async function availableProductIds(productModel, where, filters, mergedValues, priceRange = null, {database,priceContext={}} = {}) {
 if(priceContext.searchColorValues&&!priceContext.searchColorValues.length)return [];
 // Return IDs directly from an exact database EXISTS query. Transferring all
 // matching variants just to test them again in JavaScript is unnecessary.
 if(database)try{const ids=await availableProductIdsInDatabase(database,where,filters,mergedValues,priceRange,priceContext);if(ids!==null)return ids;}catch{/* Preserve the established path if this optional optimization is unavailable. */}
  const ids = [];
  const selected = Object.entries(filters || {}).filter(([, values]) => values.length);
  // Use a conservative database prefilter, then retain the exact option-position
  // check below. This avoids transferring every available variant in a large
  // collection just to test a selected color/size in the web process.
  const variantWhere = priceContext.stockOnly===false?{}:{available:true};
  if (priceRange&&!Array.isArray(priceRange)){
    if(priceContext.country&&!priceContext.basePrice)variantWhere.marketPrices={path:[priceContext.country,'price'],gte:priceRange.min,...(priceRange.max===Infinity||priceRange.max==null?{}:{lte:priceRange.max})};
    else variantWhere.price = { gte: priceRange.min, ...(priceRange.max===Infinity||priceRange.max==null?{}:{lte:priceRange.max}) };
  }
  if (selected.length) variantWhere.AND = selected.map(([name, values]) => {
    const expanded = selectedVariantValues(name,values,mergedValues);
    return { OR: [...expanded].flatMap(value => [1, 2, 3].flatMap(position => [
      { [`option${position}`]: { contains: value, mode: 'insensitive' } },
      ...(value === '' ? [{ [`option${position}`]: null }] : []),
    ])) };
  });
  if(priceContext.searchColorValues){
    variantWhere.AND ||= [];
    variantWhere.AND.push({OR:priceContext.searchColorValues.flatMap(value=>[1,2,3].map(position=>({[`option${position}`]:{contains:normalize(value),mode:'insensitive'}})))});
  }
  let cursor;
  for (;;) {
    const rows = await productModel.findMany({
      where: { ...where, variants: { some: variantWhere } },
      select: selected.length || priceRange || priceContext.ranges?.length || priceContext.requirePrice || priceContext.searchColorValues
        ? { id: true, options: true, variants: { where: variantWhere, select: { available: true, option1: true, option2: true, option3: true, ...(priceRange || priceContext.ranges?.length || priceContext.requirePrice ? {price: true,...(priceContext.country&&!priceContext.basePrice?{marketPrices:true}:{})} : {}) } } }
        : { id: true },
      orderBy: { id: 'asc' }, take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) if ((!selected.length && !priceRange && !priceContext.ranges?.length && !priceContext.requirePrice && !priceContext.searchColorValues) || matchingAvailableVariants(row, filters, mergedValues, priceRange,priceContext).length) ids.push(row.id.split('/').pop());
    if (rows.length < 1000) break;
    cursor = rows.at(-1).id;
  }
  return ids;
}
