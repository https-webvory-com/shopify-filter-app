async () => {
  const wait=()=>new Promise(r=>setTimeout(r,50)),results=[];
  const assert=(v,m)=>{if(!v)throw Error(m);};
  const click=async e=>{assert(e,'Expected control is missing');e.click();await wait();};
  const save=async()=>{await click([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='UPDATE'));assert(window.identityPayload,'No form payload');return window.identityPayload;};
  const open=()=>click([...document.querySelectorAll('span')].find(e=>e.textContent.trim()==='New Arrivals'&&e.parentElement.style.padding==='10px 14px')?.parentElement);
  const option=title=>[...document.querySelectorAll('span')].filter(e=>e.textContent.trim()===title&&e.parentElement.style.padding==='8px 16px').map(e=>e.parentElement);
  const reset=async()=>{window.mountIdentityRule();await wait();};
  await reset();await open();const choices=option('New Arrivals');
  assert(choices.length===2,'Duplicate-title choices must remain independently selectable');
  assert(!choices[0].firstElementChild.querySelector('svg')&&choices[1].firstElementChild.querySelector('svg'),'Only saved collection ID 2 should be selected');
  let p=await save();assert(p.collectionIds==='["gid://shopify/Collection/2"]','Unchanged edit lost its bound ID');results.push({test:'unchanged edit preserves the saved identity',passed:true});
  await reset();await open();await click(option('New Arrivals')[0]);await click(option('New Arrivals')[1]);p=await save();
  assert(p.collectionIds==='["gid://shopify/Collection/1"]'&&p.collections==='["New Arrivals"]','Switching duplicate-title collections lost the display title or kept the wrong ID');results.push({test:'duplicate title selection switches IDs correctly',passed:true});
  await reset();await open();await click(option('All collections')[0]);p=await save();assert(p.collectionIds==='[]'&&p.collections==='[]','All collections left stale bound IDs');results.push({test:'all collections clears explicit IDs',passed:true});
  await reset();await open();await click(option('Formal')[0]);const chip=[...document.querySelectorAll('div')].find(e=>e.style.padding==='6px 12px'&&e.textContent.trim()==='New Arrivals');await click(chip?.querySelector('div'));p=await save();
  assert(p.collectionIds==='["gid://shopify/Collection/3"]'&&p.collections==='["Formal"]','Removing a chip left stale IDs or removed the other selection');results.push({test:'chip removal preserves the other collection identity',passed:true});
  assert(window.identityUiErrors.length===0,JSON.stringify(window.identityUiErrors));return{environment:'Actual local React modal; mocked submissions; no live writes',results,errors:window.identityUiErrors};
}
