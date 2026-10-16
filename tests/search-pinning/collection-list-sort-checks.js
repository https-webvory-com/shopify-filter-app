window.runCollectionPinningListSortChecks = async () => {
  const frame=document.createElement('iframe');frame.style.cssText='width:1100px;height:900px;border:0';document.body.append(frame);
  const checks=[],delay=ms=>new Promise(r=>setTimeout(r,ms)),doc=()=>frame.contentDocument;
  const wait=async test=>{for(let i=0;i<100;i++){if(test())return;await delay(50);}throw Error('Collection list sorting UI timeout');};
  const check=(name,pass)=>{if(!pass)throw Error(name);checks.push({name,pass:true});};
  const names=()=>[...doc().querySelectorAll('tbody tr')].map(r=>r.querySelector('td span')?.textContent.trim());
  const terms=[['Jovani Dresses','[9202630684]'],['Wedding Veils','[12355371036]'],['All Collections',''],['Military Ball Dresses','[10199367708]'],['Discount Dresses','[10199728156]']];
  const rules=terms.map(([name,key],i)=>({id:'collection-'+i,name,collections:key?[name]:[],applyToAll:!key,collectionSortKey:key,ruleType:'collection',status:true,products:[],createdAt:new Date(1700000000000+i).toISOString(),importOrder:'1792129204954:12345678-1234-4234-9234-123456789abc:'+String(i+2).padStart(10,'0')}));
  const expected=['All Collections','Military Ball Dresses','Discount Dresses','Wedding Veils','Jovani Dresses'];
  const choose=async label=>{doc().querySelector('[title="Sort rules"]').click();await delay(50);[...doc().querySelectorAll('div')].find(e=>e.textContent.trim()===label).click();};
  try {
    await fetch('/__control',{method:'POST',body:JSON.stringify({listRules:rules})});
    frame.src='/collection-list-ui';await wait(()=>doc()?.querySelectorAll('tbody tr').length===5);
    check('collection pinning initially follows SoBooster ID-text order',JSON.stringify(names())===JSON.stringify(expected)&&!!doc().querySelector('th[aria-sort="ascending"]'));
    doc().querySelector('thead input[type=checkbox]').click();await delay(50);
    doc().querySelector('[aria-label="Sort by collection order"]').click();await wait(()=>names()[0]==='Jovani Dresses');
    check('collection header reverses order and exposes its direction',JSON.stringify(names())===JSON.stringify(expected.slice().reverse())&&!!doc().querySelector('th[aria-sort="descending"]'));
    check('collection sorting preserves selected IDs',doc().querySelectorAll('tbody input[type=checkbox]:checked').length===5);
    await choose('CSV order');await wait(()=>names()[0]==='Jovani Dresses');
    check('collection CSV order remains available',JSON.stringify(names())===JSON.stringify(terms.map(([name])=>name)));
    await choose('Newest first');await wait(()=>names()[0]==='Discount Dresses');
    check('collection date sorting remains available',JSON.stringify(names())===JSON.stringify(terms.map(([name])=>name).reverse()));
    check('collection sorting has no browser errors',frame.contentWindow.browserErrors.length===0);
    return {checks};
  } finally {await fetch('/__control',{method:'POST',body:JSON.stringify({listRules:null})});frame.remove();}
};
