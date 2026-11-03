import {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {mappedFacetValue} from './facetNormalization.js';

const trimCharacters='\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const productGid=id=>/^\d+$/.test(String(id))?`gid://shopify/Product/${id}`:String(id);
export const availableOptionFacetSignature=(optionValues,mergedValues)=>
 createHash('sha256').update(JSON.stringify([optionValues,mergedValues])).digest('hex');

// Facets based on Product.options include sold-out values. When selecting an
// option requires an available variant, count the same eligible variants in
// one grouped database read instead of issuing one query per displayed value.
export async function availableOptionFacetCounts(database,{shop,productIds,optionValues,mergedValues=[]}){
 if(!database?.$queryRaw||!Array.isArray(productIds)||!productIds.length)return {};
 const wanted=Object.entries(optionValues||{}).flatMap(([name,values])=>
  [...new Set(values||[])].filter(value=>typeof value==='string'&&value).map(raw=>({name,raw,canonical:mappedFacetValue(name,raw,mergedValues)})));
 if(!wanted.length)return {};
 const wantedSql=Prisma.join(wanted.map(({name,raw,canonical})=>Prisma.sql`(${name},${raw},${canonical})`));
 const totals={};
 // PostgreSQL limits bind parameters; each chunk keeps a large collection
 // within that limit while each product contributes to exactly one chunk.
 for(let start=0;start<productIds.length;start+=10000){
  const ids=productIds.slice(start,start+10000).map(productGid);
  const rows=await database.$queryRaw(Prisma.sql`
   WITH wanted(name,raw,canonical) AS (VALUES ${wantedSql})
   SELECT wanted.name AS name,wanted.canonical AS value,count(DISTINCT p."id")::integer AS count
   FROM "Product" p
   JOIN "Variant" v ON v."productId"=p."id" AND v."available"=true
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p."options")='array' THEN p."options" ELSE '[]'::jsonb END) WITH ORDINALITY AS opt(value,position)
   JOIN wanted ON lower(btrim(coalesce(opt.value->>'name',''),${trimCharacters}))=lower(btrim(wanted.name,${trimCharacters}))
    AND lower(btrim(CASE opt.position WHEN 1 THEN coalesce(v."option1",'') WHEN 2 THEN coalesce(v."option2",'') WHEN 3 THEN coalesce(v."option3",'') ELSE '' END,${trimCharacters}))=lower(btrim(wanted.raw,${trimCharacters}))
   WHERE p."shop"=${shop} AND p."id" IN (${Prisma.join(ids)}) AND opt.position<=3
   GROUP BY wanted.name,wanted.canonical`);
  for(const row of rows){
   if(!totals[row.name])totals[row.name]={};
   totals[row.name][row.value]=(totals[row.name][row.value]||0)+Number(row.count||0);
  }
 }
 return totals;
}
