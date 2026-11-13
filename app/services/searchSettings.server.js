import prisma from '../db.server';
import { DEFAULT_SEARCH_SETTINGS, validateSearchSettings } from '../utils/searchSettings.js';
import {requiresCustomSearchIndex} from '../utils/searchConfiguration.js';
import {scheduleSearchIndex,resetSearchIndexContext,retireSearchIndexes} from './searchIndex.server.js';

export async function getSearchSettings(shop) {
  const row = await prisma.searchSetting.findUnique({ where: { shop } });
  return row ? validateSearchSettings(row.config) : null;
}

export async function saveSearchSettings(shop, input,{preserveEmptyPins=false}={}) {
  const config = validateSearchSettings(input);
  const previous=await prisma.searchSetting.findUnique({where:{shop}});
  if(preserveEmptyPins)config.emptySearchProducts=previous?.config?.emptySearchProducts||[];
  const saved={...config,...(previous?.config?._index?{_index:previous.config._index}:{})};
  if(preserveEmptyPins&&previous){
    await prisma.$executeRaw`UPDATE "SearchSetting" SET config=${JSON.stringify(config)}::jsonb
      || CASE WHEN config ? '_index' THEN jsonb_build_object('_index',config->'_index') ELSE '{}'::jsonb END
      || jsonb_build_object('emptySearchProducts',COALESCE(config->'emptySearchProducts','[]'::jsonb)),"updatedAt"=NOW() WHERE shop=${shop}`;
    const latest=await prisma.searchSetting.findUnique({where:{shop}});
    config.emptySearchProducts=latest?validateSearchSettings(latest.config).emptySearchProducts:[];
  }else await prisma.searchSetting.upsert({ where: { shop }, create: { shop, config:saved }, update: { config:saved } });
  await resetSearchIndexContext(shop);
  if(requiresCustomSearchIndex(config)||previous?.config?._index)await scheduleSearchIndex(shop);
  return config;
}

export async function resetSearchSettings(shop) {
  const previous=await prisma.searchSetting.findUnique({where:{shop}});
  const activeSynonym=await prisma.synonym.findFirst({where:{shop,isActive:true},select:{id:true}});
  const emptySearchProducts=previous?.config?.emptySearchProducts||[];
  if(!activeSynonym&&emptySearchProducts.length){
    await prisma.searchSetting.update({where:{shop},data:{config:{...DEFAULT_SEARCH_SETTINGS,emptySearchProducts}}});
    await resetSearchIndexContext(shop);
    await retireSearchIndexes(shop,[previous?.config?._index?.active?.uid,previous?.config?._index?.build?.uid]);
    return;
  }
  if(activeSynonym){
    await prisma.searchSetting.upsert({where:{shop},create:{shop,config:DEFAULT_SEARCH_SETTINGS},update:{config:{...DEFAULT_SEARCH_SETTINGS,emptySearchProducts,...(previous?.config?._index?{_index:previous.config._index}:{})}}});
    await resetSearchIndexContext(shop);
    await scheduleSearchIndex(shop);
    return;
  }
  await prisma.searchSetting.deleteMany({ where: { shop } });
  // The index-context cache is versioned separately from collection ranking.
  // Restoring search defaults never invalidates saved collection pages.
  await resetSearchIndexContext(shop);
  await retireSearchIndexes(shop,[previous?.config?._index?.active?.uid,previous?.config?._index?.build?.uid]);
}
