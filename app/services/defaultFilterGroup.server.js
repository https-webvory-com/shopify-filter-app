import prisma from '../db.server';
import {invalidateShop} from './shopCache.server';

const DEFAULT_FILTERS = [
  {filterType:'price',filterKey:null,label:'Price',displayMode:'range',order:0},
  {filterType:'vendor',filterKey:null,label:'Brand',displayMode:'list',order:1},
  {filterType:'product_type',filterKey:null,label:'Product Type',displayMode:'list',order:2},
  {filterType:'collection',filterKey:null,label:'Collection',displayMode:'list',order:3},
  {filterType:'option',filterKey:'Color',label:'Color',displayMode:'list',order:4},
  {filterType:'option',filterKey:'Size',label:'Size',displayMode:'list',order:5},
];

// Setup must not depend on which admin screen a merchant opens first.
// Serializable retries also protect concurrent parent/child route loaders.
export async function ensureDefaultGroup(shop, {repair = false} = {}) {
  let changed;
  for (let attempt = 0; ; attempt++) {
    try {
      changed = await prisma.$transaction(async tx => {
        const existing = await tx.filterGroup.findFirst({
          where:{shop,isDefault:true},
          ...(repair ? {include:{collections:true,filters:true}} : {}),
        });
        if (!existing) {
          await tx.filterGroup.create({data:{
            shop,name:'Default filter group',isDefault:true,status:true,order:0,
            collections:{create:[{collectionId:'__all__',collectionTitle:'All Collections',pageType:'collection'}]},
            filters:{create:DEFAULT_FILTERS},
          }});
          return true;
        }
        // Normal app entry preserves every existing merchant choice, including
        // deliberately disabled or removed filters. The group editor retains
        // its existing repair behavior for older incomplete default groups.
        if (!repair) return false;
        let repaired = false;
        if (!existing.collections.some(c => c.collectionId === '__all__')) {
          await tx.filterGroupCollection.create({data:{filterGroupId:existing.id,collectionId:'__all__',collectionTitle:'All Collections',pageType:'collection'}});
          repaired = true;
        }
        const keys = new Set(existing.filters.map(f => `${f.filterType}:${f.filterKey ?? ''}`));
        const missing = DEFAULT_FILTERS.filter(f => !keys.has(`${f.filterType}:${f.filterKey ?? ''}`));
        if (missing.length) {
          await tx.filterGroupItem.createMany({data:missing.map(f => ({filterGroupId:existing.id,...f,isEnabled:true}))});
          repaired = true;
        }
        return repaired;
      }, {isolationLevel:'Serializable'});
      break;
    } catch (error) {
      if (error.code !== 'P2034' || attempt >= 2) throw error;
    }
  }
  // Empty prepared filter responses must become obsolete after initial setup
  // or a repair; ordinary reads must not invalidate saved collection pages.
  if (changed) await invalidateShop(shop);
  return changed;
}
