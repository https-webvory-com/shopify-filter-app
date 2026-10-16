import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
const {createOptionValueMatcher,applyMerchandisingRules,selectMerchandisingVariant}=await loadModule('app/services/merchandising.server.js',{'../db.server.js':{default:{}}});
const reference=(text,values)=>values.some(word=>
 (text||'').toLowerCase().trim()===word || Boolean(text&&word&&new RegExp(`(?:^|[\\s\\/\\-\\_,.])${word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[\\s\\/\\-\\_,.])`,'i').test(text)));

test('cached option matching preserves exact, boundary, punctuation, case and Unicode behavior',()=>{
 const groups=[[],[''],['black'],['black','ivory','champagne'],['navy blue','blue'],['c++','a.b','[red]','(gold)','a|b','x*y','a?','a$','a^','a\\b','red{2}'],['İ','i̇','é','å'],Array.from({length:400},(_,i)=>`colour ${i}`)];
 const texts=[undefined,null,'','BLACK',' Black ','Black/Gold','Black_Gold','Black-Gold','Black.Gold','Black,Gold','Dark Black','Blackberry','Offwhite','Ivory/Champagne/Honey','Navy Blue','Midnight Navy Blue','(black)','black+gold','C++','a.b','[red]','(gold)','a|b','x*y','a?','a$','a^','a\\b','red{2}','İ','i̇','É','Å','Colour 399/Gold','Colour 3999'];
 for(const values of groups){const matcher=createOptionValueMatcher(values);for(const text of texts)assert.equal(matcher(text),reference(text,values),JSON.stringify({text,values:values.slice(0,5)}));}
});

test('identical lists reuse their matcher and the cache evicts older lists',()=>{
 const first=createOptionValueMatcher(['cache-first']);assert.equal(first,createOptionValueMatcher(['cache-first']));
 for(let i=0;i<65;i++)createOptionValueMatcher(['cache-'+i]);
 assert.notEqual(first,createOptionValueMatcher(['cache-first']));assert.equal(first('CACHE-FIRST'),true);
});

test('large merged color lists retain variant, image and merchandising order',()=>{
 const sources=Array.from({length:400},(_,i)=>`colour ${i}`);
 const merged=[{targetValue:'Black',sourceValues:sources}];
 const products=[{id:'1',title:'Matching',variants:[{id:'a',option1:'Colour 399/Gold',available:true,imageUrl:'match.jpg'}],images:['match.jpg']},{id:'2',title:'Not matching',variants:[{id:'b',option1:'Colour 3999',available:true,imageUrl:'other.jpg'}],images:['other.jpg']}];
 const rule={conditions:[{action:'Boost',field:'Color (product option)',value:'Black'}]};
 const result=applyMerchandisingRules(products,rule,'best-selling',null,merged,{});
 assert.deepEqual(Array.from(result,p=>p.id),['1','2']);assert.ok(result[0].merchandisingScore>result[1].merchandisingScore);
 assert.equal(selectMerchandisingVariant({...products[0],options:[{name:'Color'}]},rule,merged).variantId,'a');
 assert.equal(selectMerchandisingVariant({...products[1],options:[{name:'Color'}]},rule,merged),null);
});
