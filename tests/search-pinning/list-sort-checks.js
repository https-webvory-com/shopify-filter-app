window.runPinningListSortChecks = async () => {
  const frame=document.createElement('iframe');frame.style.cssText='width:1100px;height:900px;border:0';document.body.append(frame);
  const checks=[],delay=ms=>new Promise(r=>setTimeout(r,ms));
  const doc=()=>frame.contentDocument;
  const wait=async test=>{for(let i=0;i<100;i++){if(test())return;await delay(50);}throw Error('List sorting UI timeout');};
  const check=(name,passed)=>{if(!passed)throw Error(name);checks.push({name,pass:true});};
  const names=()=>[...doc().querySelectorAll('tbody tr')].map(r=>r.querySelector('td span')?.textContent.trim());
  const openSort=()=>doc().querySelector('[title="Sort rules"]').click();
  const choose=label=>[...doc().querySelectorAll('div')].find(el=>el.textContent.trim()===label).click();
  const terms=['Plus Size Party Dresses','$49','$39 Dresses on Sale','','8th Grade Graduation Dresses','2 Piece Short Prom Dresses','90s Prom Dresses','A Line Dresses'];
  const csv=terms.map((q,i)=>({id:'sort-'+i,name:q||'All Searches',searchQueries:q?[q]:[],applyToAll:!q,ruleType:'search',status:true,products:[],createdAt:new Date(1700000000000+i).toISOString(),importOrder:'1792129204954:12345678-1234-4234-9234-123456789abc:'+String(i+2).padStart(10,'0')}));
  const expected=['All Searches','$39 Dresses on Sale','$49','2 Piece Short Prom Dresses','8th Grade Graduation Dresses','90s Prom Dresses','A Line Dresses','Plus Size Party Dresses'];
  try {
    await fetch('/__control',{method:'POST',body:JSON.stringify({listRules:csv})});
    frame.src='/list-ui';await wait(()=>doc()?.querySelectorAll('tbody tr').length===8);
    check('initial search pin list uses alphabetical terms with all-search first',JSON.stringify(names())===JSON.stringify(expected)&&doc().querySelector('th[aria-sort="ascending"]'));
    doc().querySelector('[aria-label="Sort by search term"]').click();await wait(()=>names()[0]==='Plus Size Party Dresses');
    check('query header reverses sorting and updates its accessible direction',JSON.stringify(names())===JSON.stringify(expected.slice().reverse())&&doc().querySelector('th[aria-sort="descending"]'));
    doc().querySelector('thead input[type=checkbox]').click();await delay(50);
    doc().querySelector('[aria-label="Sort by search term"]').click();await wait(()=>names()[0]==='All Searches');
    check('changing alphabetical direction preserves selected rule IDs',doc().querySelectorAll('tbody input[type=checkbox]:checked').length===8);
    openSort();await delay(50);choose('CSV order');await wait(()=>names()[0]==='Plus Size Party Dresses');
    check('CSV order remains separately selectable',JSON.stringify(names())===JSON.stringify(csv.map(r=>r.name))&&!doc().querySelector('th[aria-sort="ascending"]'));
    openSort();await delay(50);choose('Newest first');await wait(()=>names()[0]==='A Line Dresses');
    check('explicit newest-first still sorts by real creation dates',JSON.stringify(names())===JSON.stringify(csv.map(r=>r.name).reverse()));
    check('list sorting creates no browser errors',frame.contentWindow.browserErrors.length===0);
    return {checks};
  } finally {await fetch('/__control',{method:'POST',body:JSON.stringify({listRules:null})});frame.remove();}
};
