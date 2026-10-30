export const SEARCH_SETTING_FIELDS = {
  productLimit: ['Instant search products', 6, 1, 20],
  suggestionLimit: ['Search suggestions', 6, 0, 10],
  collectionLimit: ['Collection suggestions', 5, 0, 10],
  recentLimit: ['Recent searches', 4, 0, 10],
  minChars: ['Characters before searching', 2, 1, 5],
  pageSize: ['Products per search results page', 25, 1, 40],
  showSearchInput: ['Show search box on the results page', true],
  showVendor: ['Show vendor on search results', true],
  showSale: ['Show sale label on search results', true],
  showSoldOut: ['Show sold out label on search results', true],
};
export const ADVANCED_SEARCH_FIELDS={
  instantSearchEnabled:['Enable instant search',true],showPages:['Show page suggestions',false],pageLimit:['Page suggestions',3,0,10],
  showPopularProducts:['Show popular products when search is empty',true],popularProductLimit:['Popular products',6,1,20],
  instantColumns:['Products per row',4,1,6],showCollectionSearchInput:['Show search box on collection pages',false],
  changeBrowserUrl:['Update browser URL when filters change',true],smartSkuSearch:['Tolerate SKU typos and punctuation',false],
  broadMatch:['Allow broad text matching',true],hideUnavailableVariants:['Exclude unavailable variants from the search index',false],
  omitProductMetafields:['Omit unselected product metafields',false],omitProductMetaobjects:['Omit product metaobject values',true],
  omitVariantMetafields:['Omit unselected variant metafields',false],omitVariantMetaobjects:['Omit variant metaobject values',true],
};
export const DEFAULT_SEARCH_FIELD_CONFIG=Object.freeze([
 ['title','Product title',1],['handle','Product handle',.95],['productType','Product type',.8],['vendor','Vendor',.8],['tags','Tags',.7],
 ['collections','Collections',.5],['sku',"Variants’ SKU",.9],['barcode','Barcode',.8],['description','Product description',.3],
 ['option:*','Product options',.7],['productMetafield:*','Product metafields',.5],
].map(([key,label,weight])=>Object.freeze({key,label,weight,search:!['description','barcode','collections'].includes(key),suggest:!['sku','barcode','description','handle'].includes(key),transforms:[],indexTransforms:[],delimiter:'',numeric:false})));
const advancedDefaults=Object.fromEntries(Object.entries(ADVANCED_SEARCH_FIELDS).map(([key,field])=>[key,field[1]]));
export const SEARCH_ENUM_FIELDS={
 instantLayout:['fullscreen','two-columns','grid'],productColumn:['left','right'],pagination:['load-more','infinite'],imageSizeType:['dynamic','original','fixed'],productDateType:['created','published','updated'],
};
const enumDefaults={instantLayout:'fullscreen',productColumn:'left',pagination:'load-more',imageSizeType:'dynamic',productDateType:'published'};
export const DEFAULT_SEARCH_SETTINGS = Object.freeze(Object.fromEntries([
  ...Object.entries(SEARCH_SETTING_FIELDS).map(([key, field]) => [key, field[1]]),
  ['manualSuggestions', []],
  ...Object.entries(advancedDefaults),...Object.entries(enumDefaults),
  ['searchResultsPath','/search'],['searchBoxSelector',''],['priceUnit',''],['fixedImageWidth',600],
  ['returnedMetafields',[]],['stopwords',[]],['tokenDelimiters',[]],['tentativeDelimiters',[]],['fields',DEFAULT_SEARCH_FIELD_CONFIG],
]));

const text=(value,label,max)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/u.test(value))throw Error(label+': enter valid text.');return value.trim();};
const literalText=(value,label,max)=>{text(value,label,max);return value;};
const list=(value,label,max=100)=>{if(!Array.isArray(value)||value.length>max)throw Error(label+': too many entries.');return [...new Set(value.map(v=>text(v,label,200)).filter(Boolean))];};
const transforms=(value)=>{
 if(!Array.isArray(value)||value.length>10)throw Error('Use up to 10 transformations per field.');
 return value.map(rule=>{
  if(!rule||!['trim','trim-start','trim-end','lowercase','uppercase','strip-html','remove-prefix','remove-suffix','replace'].includes(rule.type))throw Error('Invalid field transformation.');
  return {type:rule.type,...(['remove-prefix','remove-suffix','replace'].includes(rule.type)?{value:literalText(rule.value,'Transform text',100)}:{}),...(rule.type==='replace'?{replacement:literalText(rule.replacement??'','Replacement text',100)}:{})};
 });
};

export function validateSearchSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid search settings.');
  const result = {};
  for (const [key, [label, fallback, min, max]] of Object.entries(SEARCH_SETTING_FIELDS)) {
    const value = input[key];
    if (typeof fallback === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`${label}: choose enabled or disabled.`);
    } else if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${label}: enter a whole number between ${min} and ${max}.`);
    }
    result[key] = value;
  }
  if (!Array.isArray(input.manualSuggestions) || input.manualSuggestions.length > 10) throw new Error('Enter up to 10 manual suggestions, one per line.');
  result.manualSuggestions = [];
  const seen = new Set();
  for (const item of input.manualSuggestions) {
    if (typeof item !== 'string' || /[\u0000-\u001f\u007f]/u.test(item)) throw new Error('Manual suggestions must be plain search terms.');
    const term = item.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!term || term.length > 100) throw new Error('Each manual suggestion must contain 1–100 characters.');
    if (!seen.has(term.toLowerCase())) result.manualSuggestions.push(term);
    seen.add(term.toLowerCase());
  }
  // Existing saved configurations gain new defaults without a migration.
  for(const [key,[label,fallback,min,max]]of Object.entries(ADVANCED_SEARCH_FIELDS)){
    const value=input[key]===undefined?fallback:input[key];
    if(typeof fallback==='boolean'?typeof value!=='boolean':!Number.isInteger(value)||value<min||value>max)throw Error(label+': invalid value.');
    result[key]=value;
  }
  for(const [key,choices]of Object.entries(SEARCH_ENUM_FIELDS)){
    const value=input[key]??enumDefaults[key];if(!choices.includes(value))throw Error('Invalid '+key+'.');result[key]=value;
  }
  result.searchResultsPath=text(input.searchResultsPath??'/search','Search results URL',200);
  if(!/^\/(?!\/)[a-z0-9/_-]*$/i.test(result.searchResultsPath)||result.searchResultsPath==='/')throw Error('Use a store path such as /search or /pages/search.');
  result.searchBoxSelector=text(input.searchBoxSelector??'','Search box selector',300);
  result.priceUnit=text(input.priceUnit??'','Price unit',80);
  result.fixedImageWidth=input.fixedImageWidth??600;if(!Number.isInteger(result.fixedImageWidth)||result.fixedImageWidth<100||result.fixedImageWidth>2000)throw Error('Fixed image width must be 100–2000 pixels.');
  for(const key of ['stopwords','returnedMetafields','tokenDelimiters','tentativeDelimiters'])result[key]=list(input[key]??[],key,key==='stopwords'?500:100);
  if(result.returnedMetafields.some(v=>!/^\w[\w-]*\.[\w-]+$/.test(v)))throw Error('Metafields must use namespace.key.');
  for(const key of ['tokenDelimiters','tentativeDelimiters'])if(result[key].some(v=>[...v].length!==1))throw Error('Token delimiters must be individual characters.');
  const fields=input.fields??DEFAULT_SEARCH_FIELD_CONFIG;
  if(!Array.isArray(fields)||fields.length>40)throw Error('Use up to 40 search fields.');
  const seenFields=new Set();result.fields=fields.map(field=>{
    if(!field||typeof field!=='object')throw Error('Invalid search field.');
    const key=text(field.key,'Search field',150);
    if(!/^(title|handle|description|productType|vendor|tags|collections|sku|barcode|option:(?:\*|[^\u0000-\u001f]{1,80})|(?:product|variant)Metafield:(?:\*|[\w-]+\.[\w-]+))$/.test(key)||seenFields.has(key))throw Error('Invalid or duplicate search field.');
    seenFields.add(key);
    if(key==='variantMetafield:*')throw Error('Choose a variant metafield using namespace.key.');
    if(typeof field.weight!=='number'||!Number.isFinite(field.weight)||field.weight<0||field.weight>1)throw Error('Field weights must be between 0 and 1.');
    for(const property of ['search','suggest','numeric'])if(typeof field[property]!=='boolean')throw Error('Invalid search-field option.');
    return {key,label:text(field.label??key,'Field label',100),weight:field.weight,search:field.search,suggest:field.suggest,numeric:field.numeric,
      delimiter:literalText(field.delimiter??'','Field delimiter',10),transforms:transforms(field.transforms??[]),indexTransforms:transforms(field.indexTransforms??[])};
  });
  return result;
}
