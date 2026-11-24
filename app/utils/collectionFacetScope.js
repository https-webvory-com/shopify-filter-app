export const collectionFacetScopeVersion=1;

export function hasCurrentCollectionFacetScope(payload){
 return !payload?.facets||!payload.debug?.activeRuleConditions?.some(rule=>rule.action==='Include')||
  payload.facets.collectionScopeVersion===collectionFacetScopeVersion;
}

// Keep verified product cards usable while an Include-expanded legacy facet
// snapshot is replaced. The existing version-two follow-up reads fresh facets.
export function withoutLegacyCollectionFacets(payload){
 if(hasCurrentCollectionFacetScope(payload))return payload;
 const {facets,...cards}=payload;
 return {...cards,cfpCards:{...cards.cfpCards,version:2,published:false,facetsReady:false}};
}
