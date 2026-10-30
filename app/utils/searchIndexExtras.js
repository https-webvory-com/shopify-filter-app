// Background-only Shopify reads. Every selected metafield name is a variable;
// untrusted namespaces/keys never become executable GraphQL syntax.
export async function readSearchIndexExtras(admin,documents,settings){
 if(!documents.length)return [];
 const productFields=settings.fields.filter(f=>(f.search||f.suggest)&&f.weight>0&&f.key.startsWith('productMetafield:')&&f.key!=='productMetafield:*');
 const variantFields=settings.fields.filter(f=>(f.search||f.suggest)&&f.weight>0&&f.key.startsWith('variantMetafield:')&&f.key!=='variantMetafield:*');
 const definitions=[],values={},metafields=(fields,kind)=>fields.map((field,i)=>{
  const [namespace,key]=field.key.slice(17).split('.'),n=kind+i+'Namespace',k=kind+i+'Key';definitions.push('$'+n+':String!','$'+k+':String!');values[n]=namespace;values[k]=key;
  const omit=kind==='p'?settings.omitProductMetaobjects:settings.omitVariantMetaobjects;
  return `${kind}${i}:metafield(namespace:$${n},key:$${k}){value type ${omit?'':'reference{... on Metaobject{fields{key value}}}'}}`;
 }).join('\n');
 const productMetafields=metafields(productFields,'p'),variantMetafields=metafields(variantFields,'v');
 const variantsNeeded=variantFields.length>0||settings.fields.some(f=>f.key==='barcode'&&(f.search||f.suggest)&&f.weight>0);
 const variantSelection=variantsNeeded?`variants(first:100,after:$after){nodes{id barcode ${variantMetafields}}pageInfo{hasNextPage endCursor}}`:'';
 const operation=`query SearchIndexMetadata($id:ID!${variantsNeeded?',$after:String':''}${definitions.length?','+definitions.join(','):''}){product(id:$id){id description createdAt publishedAt updatedAt ${productMetafields} ${variantSelection}}}`;
 const result=[];
 const decode=field=>{if(!field)return null;if(field.reference?.fields)return field.reference.fields.map(f=>f.value).join(' ');if(field.type?.includes('metaobject_reference'))return null;if(field.type?.startsWith('list.'))try{return JSON.parse(field.value);}catch{}return field.value;};
 for(const doc of documents){
  let after=null,product,variants=[],pages=0;const cursors=new Set();
  do{
   const response=await admin.graphql(operation,{variables:{...values,id:'gid://shopify/Product/'+doc.id,after},signal:AbortSignal.timeout(30000)});
   const body=await response.json();if(response.ok===false||body.errors||!body.data||!Object.hasOwn(body.data,'product'))throw Error('Search metadata could not be read from Shopify');
   const current=body.data.product;if(!current){product=null;break;}
   if(String(current.id).split('/').pop()!==String(doc.id))throw Error('Search metadata product identity mismatch');
   product=current;
   if(!variantsNeeded)break;
   if(!Array.isArray(current.variants?.nodes)||typeof current.variants.pageInfo?.hasNextPage!=='boolean')throw Error('Incomplete search metadata variants');
   variants.push(...current.variants.nodes);
   if(!current.variants.pageInfo.hasNextPage)break;
   after=current.variants.pageInfo.endCursor;if(!after||cursors.has(after)||++pages>100)throw Error('Search metadata pagination stalled');cursors.add(after);
  }while(true);
  if(!product)continue;
  const enriched={...doc,_searchExtras:{description:product.description,createdAt:product.createdAt,publishedAt:product.publishedAt,updatedAt:product.updatedAt}};
  for(const [i,field]of productFields.entries())enriched['metafield_'+field.key.slice(17)]=decode(product['p'+i]);
  if(variantsNeeded){
   const byId=new Map();for(const variant of variants){const id=String(variant.id).split('/').pop();if(byId.has(id))throw Error('Duplicate search metadata variant');byId.set(id,variant);}
   enriched.variantPrices=(doc.variantPrices||[]).map(v=>{
    const current=byId.get(String(v.id));if(!current)throw Error('Search metadata is missing a synced variant');
    return {...v,barcode:current.barcode,searchMetafields:Object.fromEntries(variantFields.map((f,i)=>[f.key.slice(17),decode(current['v'+i])]))};
   });
  }
  result.push(enriched);
 }
 return result;
}
