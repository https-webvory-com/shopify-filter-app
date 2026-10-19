const cleanId = id => String(id).split('/').pop();
const fullRankingFields = ['id', 'title', 'vendor', 'productType', 'tags', 'priceMin', 'inventoryTotal', 'variantPrices', 'options', 'images', 'collections', 'collection_titles', 'bestSellingScore', 'trendingScore', 'createdAt', 'rating', 'metafield_reviews.rating'];

export async function hydrateCollectionSkus(products, variantModel, shop) {
  const missing = products.filter(p => !p.variants?.length || p.variants.some(v => v.sku === undefined));
  for (let offset = 0; offset < missing.length; offset += 1000) {
    const batch = missing.slice(offset, offset + 1000);
    const rows = await variantModel.findMany({ where: { productId: { in: batch.map(p => p.id) }, product: {shop} }, select: { productId: true, id: true, sku: true, available: true, price: true, compareAtPrice: true, option1: true, option2: true, option3: true, imageUrl: true } });
    const grouped = new Map();
    for (const row of rows) { if (!grouped.has(row.productId)) grouped.set(row.productId, []); grouped.get(row.productId).push(row); }
    for (const product of batch) product.variants = (grouped.get(product.id) || []).map(row => ({
      ...(product.variants || []).find(v => cleanId(v.id) === cleanId(row.id)), ...row,
    }));
  }
}

export async function hydrateCollectionPrices(products, productModel, shop) {
  const missing = products.filter(p => p.priceMin == null || p.priceMin === '' || !Number.isFinite(Number(p.priceMin)));
  for (let offset = 0; offset < missing.length; offset += 1000) {
    const batch = missing.slice(offset, offset + 1000);
    const rows = await productModel.findMany({
      where: {shop, id: {in: batch.map(p => p.id)}}, select: {id: true, priceMin: true},
    });
    const prices = new Map(rows.map(row => [row.id, row.priceMin]));
    for (const product of batch) if (prices.has(product.id)) product.priceMin = prices.get(product.id);
  }
}

// Old index documents did not contain inventory. Never treat missing inventory
// as zero: a global sold-out exclusion would otherwise remove the whole store.
export async function hydrateCollectionInventory(products, variantModel) {
  const missing = products.filter(p => !Number.isFinite(p.inventoryTotal));
  for (let offset = 0; offset < missing.length; offset += 1000) {
    const batch = missing.slice(offset, offset + 1000);
    const rows = await variantModel.groupBy({
      by: ['productId'], where: {productId: {in: batch.map(p => p.id)}}, _sum: {inventory: true},
    });
    const totals = new Map(rows.map(row => [row.productId, row._sum.inventory ?? 0]));
    for (const product of batch) product.inventoryTotal = totals.get(product.id) ?? 0;
  }
}

export function collectionRankingFields(conditions, sortBy, hasShopifyOrder = true) {
  // Older callers retain the full projection. Tag-only collections must not
  // transfer tens of thousands of products' variant arrays just to rank IDs.
  if (!Array.isArray(conditions)) return fullRankingFields;
  const fields = new Set(['id']);
  if (['best-selling', 'bestselling'].includes(sortBy)) fields.add('priceMin');
  if (!hasShopifyOrder && ['best-selling', 'bestselling'].includes(sortBy)) fields.add('bestSellingScore');
  if (sortBy?.startsWith('price')) fields.add('priceMin');
  if (['created-ascending', 'created-descending'].includes(sortBy)) fields.add('createdAt');
  if (['title-ascending', 'title-descending'].includes(sortBy)) fields.add('title');
  if (sortBy && !['best-selling', 'bestselling', 'price-ascending', 'price-descending', 'created-ascending', 'created-descending', 'title-ascending', 'title-descending'].includes(sortBy)) return fullRankingFields;
  for (const condition of conditions) {
    const field = (condition.field || '').toLowerCase();
    const simple = { tags: ['tags'], vendor: ['vendor'], 'product type': ['productType'], product: ['title'], collections: ['collections', 'collection_titles'], price: ['priceMin'], date: ['createdAt'], sku: ['variantPrices'], rating: ['rating', 'metafield_reviews.rating'], id: [] };
    if (field in simple) simple[field].forEach(value => fields.add(value));
    else if (field === 'available') { fields.add('inventoryTotal'); fields.add('available'); }
    else if (['discount', 'percent sales'].includes(field) || /option|color|size|title/.test(field)) {
      ['variantPrices', 'options', 'images'].forEach(value => fields.add(value));
    } else return fullRankingFields;
  }
  return [...fields];
}

// Rank and exclude the complete eligible set before allocating any page slots.
export async function buildCollectionSequence(index, { query, pinnedIds, orderedIds, arrange, conditions, sortBy, hydrateRanking, compare }) {
  if (compare) return buildCompactSequence(index,{query,pinnedIds,orderedIds,arrange,conditions,sortBy,hydrateRanking,compare});
  const { indexUid, q, ...options } = query;
  const documents = [];
  const seen = new Set();
  const batchSize = 1000;
  for (let offset = 0; ; offset += batchSize) {
    const result = await index.search(q, {
      ...options, offset, limit: batchSize,
      attributesToRetrieve: collectionRankingFields(conditions, sortBy, Array.isArray(orderedIds)),
    });
    for (const product of result.hits) {
      const id = cleanId(product.id);
      if (seen.has(id)) throw new Error('Collection changed while ranking; retry the request');
      seen.add(id);
      documents.push({ ...product, id });
    }
    if (result.hits.length < batchSize) {
      const expected = result.totalHits ?? result.estimatedTotalHits;
      if (expected != null && documents.length !== expected) throw new Error('Incomplete collection ranking results');
      break;
    }
  }
  const ranks = orderedIds ? new Map(orderedIds.map((id, rank) => [cleanId(id), rank])) : null;
  if (ranks) documents.sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
  // Valid pins awaiting indexing must retain their slots for DB hydration.
  for (const id of pinnedIds.map(cleanId)) {
    if (!seen.has(id)) { documents.push({ id }); seen.add(id); }
  }
  const products = documents.map((p, i) => ({
    ...p, id: `gid://shopify/Product/${p.id}`, _originalIndex: i,
    variants: p.variantPrices || [],
    collections: p.collection_titles?.map(title => ({ collection: { title } })) || p.collections || [],
  }));
  if (hydrateRanking) await hydrateRanking(products);
  const ranked = arrange(products);
  // Partition the complete ranking before pagination. Keep Shopify's relative
  // order in each group; unknown prices must not be treated as free products.
  if (ranks && ['best-selling', 'bestselling'].includes(sortBy)) {
    const isFree = product => product.priceMin != null && product.priceMin !== '' &&
      Number.isFinite(Number(product.priceMin)) && Number(product.priceMin) === 0;
    return [...ranked.filter(product => !isFree(product)), ...ranked.filter(isFree)]
      .map(product => cleanId(product.id));
  }
  return ranked.map(product => cleanId(product.id));
}

// Keep at most one batch of variant/image data. Rule evaluation is per product;
// the shared merchandising comparator orders compact results across all batches.
async function buildCompactSequence(index,{query,pinnedIds,orderedIds,arrange,conditions,sortBy,hydrateRanking,compare}) {
  const {indexUid,q,...options}=query;
  const ranks=orderedIds?new Map(orderedIds.map((id,i)=>[cleanId(id),i])):null;
  const seen=new Set(),ranked=[];
  const fields=collectionRankingFields(conditions,sortBy,Array.isArray(orderedIds));
  // Variant arrays can dominate a response even when few products match.
  // Scalar/tag projections do not carry variants or collection membership
  // arrays. Read them in fewer round trips; keep large nested projections
  // bounded by their existing smaller batches.
  const batchSize=fields.includes('variantPrices')?25:fields.some(field=>['collections','collection_titles','options','images'].includes(field))?1000:10000;
  let scanned=0;
  async function consume(documents) {
    const products=documents.map(p=>({...p,id:`gid://shopify/Product/${cleanId(p.id)}`,variants:p.variantPrices||[],collections:p.collection_titles?.map(title=>({collection:{title}}))||p.collections||[]}));
    if(hydrateRanking)await hydrateRanking(products);
    for(const p of arrange(products))ranked.push({id:p.id,title:p.title,priceMin:p.priceMin,createdAt:p.createdAt,bestSellingScore:p.bestSellingScore,trendingScore:p.trendingScore,_originalIndex:p._originalIndex,_rulePinned:p._rulePinned,_collectionPinsFirst:p._collectionPinsFirst,_collectionLadderMatched:p._collectionLadderMatched,_collectionRuleRanks:p._collectionRuleRanks,_collectionSequentialScore:p._collectionSequentialScore,merchandisingScore:p.merchandisingScore});
  }
  for(let offset=0;;offset+=batchSize) {
    const result=await index.search(q,{...options,offset,limit:batchSize,attributesToRetrieve:fields},{signal:AbortSignal.timeout(30000)});
    const documents=result.hits.map(product=>{
      const id=cleanId(product.id);if(seen.has(id))throw Error('Collection changed while ranking; retry the request');
      const sequence=scanned++;seen.add(id);
      return {...product,id,_originalIndex:ranks?(ranks.get(id)??orderedIds.length+sequence):sequence};
    });
    await consume(documents);
    if(result.hits.length<batchSize){const expected=result.totalHits??result.estimatedTotalHits;if(expected!=null&&scanned!==expected)throw Error('Incomplete collection ranking results');break;}
  }
  const missing=[...new Set((pinnedIds||[]).map(cleanId))].filter(id=>!seen.has(id));
  for(let offset=0;offset<missing.length;offset+=1000)await consume(missing.slice(offset,offset+1000).map((id,i)=>({id,_originalIndex:(orderedIds?.length||0)+scanned+offset+i})));
  ranked.sort((a,b)=>compare(a,b)||(a._originalIndex??0)-(b._originalIndex??0));
  if(ranks&&['best-selling','bestselling'].includes(sortBy)){
    const isFree=p=>p.priceMin!=null&&p.priceMin!==''&&Number.isFinite(Number(p.priceMin))&&Number(p.priceMin)===0;
    return [...ranked.filter(p=>!isFree(p)),...ranked.filter(isFree)].map(p=>cleanId(p.id));
  }
  return ranked.map(p=>cleanId(p.id));
}

const unsupportedDocumentBatches = new WeakMap();

export async function readRankedCollectionPage(index, { ids, page, limit, attributes, shop, batchOwner=index }) {
  const selected = ids.slice((page - 1) * limit, page * limit);
  const documents = new Map();
  const fields=shop && attributes ? [...new Set([...attributes,'shop'])] : attributes;
  const validate=product=>{
    if (shop && product.shop && product.shop !== shop) throw new Error('Collection ranking session expired; product tenant changed');
    if (product.status && product.status.toUpperCase() !== 'ACTIVE') throw new Error('Collection ranking session expired; product eligibility changed');
  };
  // Fetch only this frozen page, then restore its exact ID order. Older servers
  // without document filters retain the individual-read path; no index setting
  // changes, ids query parameter, search ranking or global result cap is needed.
  if (selected.length && selected.length<=250 && selected.every(id=>typeof id==='string' && /^[A-Za-z0-9_-]+$/.test(id)) &&
      (!attributes || attributes.includes('id')) && typeof index.getDocuments==='function' &&
      (unsupportedDocumentBatches.get(batchOwner) || 0)<Date.now()) {
    let timer, response;
    try {
      response=await Promise.race([index.getDocuments({filter:'id IN '+JSON.stringify([...new Set(selected)]),fields,limit:selected.length,offset:0}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Collection page read timed out')),30000);})]);
    } catch(error) {
      if (error.code==='invalid_document_filter' || error.code==='route_not_found' || error.httpStatus===405 ||
          /Unknown field.*(?:ids|filter)/i.test(error.message || '')) unsupportedDocumentBatches.set(batchOwner,Date.now()+60000);
      else throw error;
    } finally {clearTimeout(timer);}
    if (response) {
      if (!Array.isArray(response.results)) throw new Error('Invalid collection document batch');
      const requested=new Set(selected);
      for (const product of response.results) {
        const id=String(product.id);
        if (!requested.has(id) || documents.has(id)) throw new Error('Invalid collection document batch');
        validate(product);documents.set(id,product);
      }
      // Verify omitted records individually: an older server may cap a batch,
      // and a missing record still needs the original document-not-found path.
    }
  }
  const missing=selected.filter(id=>!documents.has(id));
  for (let offset = 0; offset < missing.length; offset += 8) {
    await Promise.all(missing.slice(offset, offset + 8).map(async id => {
      try {
        const product = await index.getDocument(id, { fields },{signal:AbortSignal.timeout(30000)});
        validate(product);
        documents.set(id, product);
      }
      catch (error) {
        if (error.code !== 'document_not_found') throw error;
        documents.set(id, { id }); // Hydrate from DB without moving later page slots.
      }
    }));
  }
  return { hits: selected.map(id => documents.get(id)), total: ids.length };
}
