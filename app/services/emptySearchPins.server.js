import prisma from '../db.server.js';
import {DEFAULT_SEARCH_SETTINGS,validateSearchSettings} from '../utils/searchSettings.js';
import {validateSelectedSearchProducts} from './searchCollectionPicker.server.js';
import {resetSearchIndexContext} from './searchIndex.server.js';

// Moving the editor does not require rewriting saved merchant selections.
// Existing settings remain the fallback until the merchant saves their pin.
export async function legacyEmptySearchProducts(shop){
  const row=await prisma.searchSetting.findUnique({where:{shop}});
  return row?validateSearchSettings(row.config).emptySearchProducts:[];
}

export async function saveEmptySearchPin(shop,{id,products,enabled=true}){
  const normalized=validateSearchSettings({...DEFAULT_SEARCH_SETTINGS,emptySearchProducts:products}).emptySearchProducts;
  const selected=await validateSelectedSearchProducts(shop,normalized);
  const result=await prisma.$transaction(async tx=>{
    const existing=await tx.pinnedProductRule.findFirst({where:{shop,ruleType:'search',applyToAll:false,searchQueries:{has:''}},orderBy:{createdAt:'desc'}});
    if(id!=='new'&&existing&&existing.id!==id)throw Error('An empty search pin already exists. Edit that pin instead.');
    let saved=null;
    if(selected.length){
      const data={shop,name:'Empty search pin',ruleType:'search',applyToAll:false,searchQueries:[''],applyToSearchType:enabled?'instant':'none',products:selected};
      const target=id==='new'?existing?.id:id;
      saved=target?await tx.pinnedProductRule.update({where:{id:target,shop,ruleType:'search'},data}):await tx.pinnedProductRule.create({data});
    }else if(id!=='new'||existing){
      await tx.pinnedProductRule.deleteMany({where:{id:id==='new'?existing.id:id,shop,ruleType:'search'}});
    }
    // Only this presentation key changes; concurrently edited fields and
    // active index metadata are preserved by PostgreSQL's atomic JSON update.
    await tx.$executeRaw`UPDATE "SearchSetting" SET config=jsonb_set(config,'{emptySearchProducts}','[]'::jsonb),"updatedAt"=NOW() WHERE shop=${shop}`;
    return saved;
  });
  await resetSearchIndexContext(shop);
  return result;
}
