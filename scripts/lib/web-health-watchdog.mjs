import http from 'node:http';

export function probeWebHealth(url,timeoutMs=5000){
 return new Promise(resolve=>{
  const request=http.get(url,{agent:false},response=>{
   let body='';response.setEncoding('utf8');
   response.on('data',chunk=>{body+=chunk;if(body.length>16){resolve(false);request.destroy();}});
   response.on('end',()=>resolve(response.statusCode===200&&body==='ok'));
   response.on('error',()=>resolve(false));
  });
  request.setTimeout(timeoutMs,()=>request.destroy());
  request.on('error',()=>resolve(false));
 });
}

export function watchWebHealth({url,onUnresponsive,probe=probeWebHealth,startupMs=60000,intervalMs=10000,failures=3,onFailure=()=>{}}){
 let stopped=false,timer,misses=0;
 const check=async()=>{
  let healthy=false;try{healthy=await probe(url);}catch{}
  if(stopped)return;
  misses=healthy?0:misses+1;
  if(misses)onFailure(misses);
  if(misses>=failures){stopped=true;onUnresponsive();return;}
  timer=setTimeout(check,intervalMs);
 };
 timer=setTimeout(check,startupMs);
 return ()=>{stopped=true;clearTimeout(timer);};
}
