import {db,load,shop,form} from '../search-redirect/layer.mjs';
import * as helpers from '../../app/utils/suggestionBlacklist.js';
import {buildSearchSuggestions} from '../../app/utils/searchSuggestions.js';
import {selectSearchColorVariant} from '../../app/utils/searchColor.js';
import {spellingCorrection} from '../../app/utils/spellingCorrection.js';

export {db,shop,form};
export const service=await load('app/services/suggestionBlacklist.server.js',{
  '../db.server':{__esModule:true,default:db},'../utils/suggestionBlacklist.js':helpers,
});
export const admin=await load('app/routes/app.search.blacklist.jsx',{
  '../components/SearchConfigurationLayout': { default: () => null }, 'react-router':{},react:{},'@shopify/shopify-app-react-router/server':{boundary:{}},
  '../shopify.server':{authenticate:{admin:async()=>({session:{shop}})}},
  '../db.server':{__esModule:true,default:db},'../services/suggestionBlacklist.server.js':service,
  '../utils/suggestionBlacklist.js':helpers,
});
export const products=[
  {id:'1',title:'Blue Dress',status:'ACTIVE',handle:'blue-dress'},
  {id:'2',title:'Red Dress',status:'ACTIVE',handle:'red-dress'},
  {id:'3',title:'Blue Dress Sale',status:'ACTIVE',handle:'blue-dress-sale'},
  {id:'4',title:'Sundress',status:'ACTIVE',handle:'sundress'},
].map(product=>({...product,priceMin:20,priceMax:20,tags:[],options:[],images:[],variantPrices:[]}));
export const state={failRules:false,searchRequests:0};
export const api=await load('app/routes/api.search.jsx',{
  '../services/queryParser.server.js':{parseQuery:async()=>null},
  '../utils/searchColor.js':{selectSearchColorVariant},'../utils/spellingCorrection.js':{spellingCorrection},
  '../utils/searchSuggestions.js':{buildSearchSuggestions},
  '../services/suggestionBlacklist.server.js':{getActiveSuggestionBlacklist:async requestedShop=>{
    if(state.failRules)throw Error('Fixture rule lookup failure');
    return service.getActiveSuggestionBlacklist(requestedShop);
  }},
  'react-router':{data:(value,init)=>Response.json(value,init)},'../db.server':{__esModule:true,default:db},
  '../services/merchandising.server':{getActivePinningRuleForSearch:async()=>null,getActiveRuleForSearch:async()=>null},
  '../services/searchRanking.server.js':{rankSearchResults:async()=>{throw Error('Unexpected ranking in the unconfigured blacklist fixture');}},
  '../services/meiliClient.server':{__esModule:true,default:{index:()=>({searchForFacetValues:async()=>({facetHits:[]})})}},
  '../services/filterSettings.server':{},'../services/shopCache.server':{getCached:async()=>({})},
  '../services/rateLimiter.server':{rateLimit:async()=>true},
  '../services/semanticSearch.server':{semanticSearch:async(_query,options)=>{
    if(!options.filter.includes(`shop = '${shop}'`))return {hits:[]};
    return {hits:products};
  }},
});
