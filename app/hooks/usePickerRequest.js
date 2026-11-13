import {useCallback,useEffect,useRef,useState} from 'react';

// Picker transport is isolated from route navigation: a 504 or invalid response
// must not unmount the editor and discard the merchant's unsaved selection.
export function usePickerRequest(scope){
  const [data,setData]=useState(),[state,setState]=useState('idle');
  const context=useRef({}),active=useRef(null),sequence=useRef(0);
  useEffect(()=>()=>{sequence.current++;active.current?.abort();},[]);
  const request=useCallback(async(values,method)=>{
    active.current?.abort();const controller=new AbortController();active.current=controller;
    const version=++sequence.current,fields={...context.current,...values};setState(method==='GET'?'loading':'submitting');
    const timer=setTimeout(()=>controller.abort(),15000);
    const metadata={query:(fields.q||'').trim(),after:fields.after||'',targetQueryKey:fields.targetQueries||'[]',queryKey:fields.searchQueries||'[]',searchField:fields.searchField||'title'};
    try{
      const token=await window.shopify?.idToken?.();
      const params=new URLSearchParams(fields),url='/app/product-picker?scope='+encodeURIComponent(scope)+(method==='GET'?'&'+params:'');
      const response=await fetch(url,{method,signal:controller.signal,headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:params}:{})});
      if(!response.ok)throw Error('Picker request failed');
      const result=await response.json();if(version===sequence.current)setData({...metadata,...result});
    }catch{
      if(version===sequence.current)setData({...metadata,products:[],collections:[],tags:[],totalCount:0,nonMatchingPinnedIds:[],error:'Could not load products. Please retry.',productPickerError:'Could not load products. Please retry.',collectionPickerError:'Could not load collections. Please retry.'});
    }finally{clearTimeout(timer);if(version===sequence.current)setState('idle');}
  },[scope]);
  const submit=useCallback(values=>request(values,'POST'),[request]);
  const load=useCallback(url=>request(Object.fromEntries(new URL(url,window.location.origin).searchParams),'GET'),[request]);
  return {data,state,submit,load,context};
}
