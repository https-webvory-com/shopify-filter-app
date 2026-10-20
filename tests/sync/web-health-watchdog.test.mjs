import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {probeWebHealth,watchWebHealth} from '../../scripts/lib/web-health-watchdog.mjs';

test('supervisor can detect and terminate a child with a blocked event loop',async()=>{
 const child=spawn(process.execPath,['--input-type=module','-e',`
 import http from 'node:http';
 const server=http.createServer((req,res)=>res.end('ok'));
 server.listen(0,'127.0.0.1',()=>process.send(server.address().port));
 process.on('message',message=>{if(message==='block'){process.send('blocking');while(true){}}});
 `],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 let stop;
 try{
  const [port]=await once(child,'message');const url='http://127.0.0.1:'+port+'/healthz';
  assert.equal(await probeWebHealth(url,500),true);
  const blocking=once(child,'message');child.send('block');await blocking;
  let misses=0;
  const exit=once(child,'exit');
  stop=watchWebHealth({url,startupMs:0,intervalMs:10,failures:3,probe:url=>probeWebHealth(url,60),
   onFailure:count=>misses=count,onUnresponsive:()=>child.kill('SIGKILL')});
  await exit;assert.equal(misses,3);
 }finally{stop?.();child.kill('SIGKILL');}
});

test('a successful probe resets failures and stopping cancels recovery',async()=>{
 const readings=[false,false,true,false,false,true];let attempts=0,recoveries=0;
 await new Promise(resolve=>{
  const stop=watchWebHealth({url:'fixture',startupMs:0,intervalMs:1,
   probe:async()=>{const result=readings[attempts++];if(attempts===readings.length){stop();resolve();}return result;},
   onUnresponsive:()=>recoveries++});
 });
 assert.equal(attempts,readings.length);assert.equal(recoveries,0);
});
