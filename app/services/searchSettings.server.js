import prisma from '../db.server';
import { DEFAULT_SEARCH_SETTINGS, validateSearchSettings } from '../utils/searchSettings.js';
import {requiresCustomSearchIndex} from '../utils/searchConfiguration.js';
import {scheduleSearchIndex,resetSearchIndexContext,retireSearchIndexes} from './searchIndex.server.js';

export async function getSearchSettings(shop) {
  const row = await prisma.searchSetting.findUnique({ where: { shop } });
  return row ? validateSearchSettings(row.config) : null;
}

export async function saveSearchSettings(shop, input,{preserveEmptyPins=false,preserveCompactCollections=false,compactCollectionsBase}={}) {
  const config = validateSearchSettings(input);
  const previous=await prisma.searchSetting.findUnique({where:{shop}});
  if(requiresCustomSearchIndex(config)&&!previous?.config?._index?.active?.uid)throw Object.assign(Error('Search setup is required before adding this rule. No full rebuild was started.'),{code:'SEARCH_INDEX_SETUP_REQUIRED'});
  const activeConfig=previous?.config?._index?.active?.config;
  if(activeConfig){
    const source=validateSearchSettings(activeConfig);
    const extraField=field=>['description','barcode'].includes(field.key)||field.key.startsWith('variantMetafield:')||field.key.startsWith('productMetafield:')&&field.key!=='productMetafield:*';
    const enabled=field=>(field.search||field.suggest)&&field.weight>0;
    const inputs=field=>JSON.stringify([field.delimiter,field.delimiters||[],field.numeric,field.transforms,field.indexTransforms]);
    if(config.productDateType!==source.productDateType||config.fields.some(field=>enabled(field)&&extraField(field)&&!source.fields.some(saved=>saved.key===field.key&&enabled(saved)&&inputs(field)===inputs(saved))))throw Object.assign(Error('This field needs source data that is not prepared for search. Your existing rules were kept; no full rebuild or Shopify sync was started.'),{code:'SEARCH_INDEX_SOURCE_REQUIRED'});
  }
  if(preserveEmptyPins)config.emptySearchProducts=previous?.config?.emptySearchProducts||[];
  if(preserveCompactCollections)config.compactCollections=previous?.config?.compactCollections||[];
  const saved={...config,...(previous?.config?._index?{_index:previous.config._index}:{})};
  if(preserveEmptyPins&&previous){
    const checkCompactVersion=!preserveCompactCollections&&compactCollectionsBase!==undefined;
    const updated=await prisma.$executeRaw`UPDATE "SearchSetting" SET config=${JSON.stringify(config)}::jsonb
      || CASE WHEN config ? '_index' THEN jsonb_build_object('_index',config->'_index') ELSE '{}'::jsonb END
      || jsonb_build_object('emptySearchProducts',COALESCE(config->'emptySearchProducts','[]'::jsonb))
      || CASE WHEN ${preserveCompactCollections} THEN jsonb_build_object('compactCollections',COALESCE(config->'compactCollections','[]'::jsonb)) ELSE '{}'::jsonb END
      || CASE WHEN jsonb_array_length(COALESCE(config->'compactCollections','[]'::jsonb))>0
        THEN jsonb_build_object('_compactCollectionsBackup',jsonb_build_object('collections',config->'compactCollections','savedAt',NOW()))
        WHEN config ? '_compactCollectionsBackup' THEN jsonb_build_object('_compactCollectionsBackup',config->'_compactCollectionsBackup') ELSE '{}'::jsonb END,
      "updatedAt"=NOW() WHERE shop=${shop} AND (${!checkCompactVersion} OR COALESCE(config->'compactCollections','[]'::jsonb)=${JSON.stringify(compactCollectionsBase??[])}::jsonb)`;
    if(updated!==1)throw Error('Compact collections changed in another tab. Reload settings before saving your menu.');
    const latest=await prisma.searchSetting.findUnique({where:{shop}});
    if(latest)Object.assign(config,validateSearchSettings(latest.config));
  }else await prisma.searchSetting.upsert({ where: { shop }, create: { shop, config:saved }, update: { config:saved } });
  await resetSearchIndexContext(shop);
  if(requiresCustomSearchIndex(config)||previous?.config?._index)await scheduleSearchIndex(shop,{allowInitialBuild:false});
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
