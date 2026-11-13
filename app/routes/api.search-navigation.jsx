import {data} from 'react-router';
import {rateLimit} from '../services/rateLimiter.server';
import {popularSearchQueries,searchCollectionCards} from '../services/searchNavigation.server.js';
import {getActiveSuggestionBlacklist} from '../services/suggestionBlacklist.server.js';
import {filterBlacklistedSuggestions} from '../utils/suggestionBlacklist.js';
const headers={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
export async function loader({request}){
 const url=new URL(request.url),shop=url.searchParams.get('shop')||'';
 const handles=(url.searchParams.get('handles')||'').split(',').filter(Boolean);
 if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)||handles.length>8||handles.some(handle=>handle.length>200||!/^[a-z0-9][a-z0-9-]*$/i.test(handle)))return data({error:'Invalid search navigation request'},{status:400,headers});
 if(!await rateLimit(request))return data({error:'Too many requests'},{status:429,headers});
 try{
  const [collections,popular,blacklist]=await Promise.all([searchCollectionCards(shop,{handles}),handles.length?[]:popularSearchQueries(shop),getActiveSuggestionBlacklist(shop)]);
  return data({collections,popularSearches:filterBlacklistedSuggestions(popular,blacklist)},{headers});
 }catch(error){console.error('Search navigation unavailable:',error.name);return data({collections:[],popularSearches:[]},{headers});}
}
