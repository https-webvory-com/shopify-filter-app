export const COLLECTION_SPACING_LIMITS = {
  collectionSideSpacing: {min:0,max:240,default:24},
  mobileCollectionSideSpacing: {min:0,max:80,default:16},
};
export const COLLECTION_LAYOUT_KEYS = ['collectionPageWidth',...Object.keys(COLLECTION_SPACING_LIMITS)];
export const isValidCollectionPageWidth = value => ['theme','custom'].includes(value);
export function isValidCollectionSpacing(key,value) {
  const limits=COLLECTION_SPACING_LIMITS[key];
  return !!limits&&['number','string'].includes(typeof value)&&String(value).trim()!==''&&Number.isInteger(Number(value))&&Number(value)>=limits.min&&Number(value)<=limits.max;
}
export function collectionLayoutSettings(settings={}) {
  return {
    collectionPageWidth:isValidCollectionPageWidth(settings.collectionPageWidth)?settings.collectionPageWidth:'theme',
    ...Object.fromEntries(Object.entries(COLLECTION_SPACING_LIMITS).map(([key,limits])=>[key,isValidCollectionSpacing(key,settings[key])?Number(settings[key]):limits.default])),
  };
}
