import fs from 'node:fs/promises';import fsSync from 'node:fs';import path from 'node:path';import net from 'node:net';import {spawnSync,spawn} from 'node:child_process';
const bin=process.env.POSTGRES_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const directory=path.resolve('scratch','redirect-postgres-'+Date.now());
await fs.mkdir(directory,{recursive:true});
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
function run(name,args){const executable=path.join(bin,name+(process.platform==='win32'?'.exe':''));const log=path.join(directory,'control.log');const descriptor=name==='pg_ctl'?fsSync.openSync(log,'a'):null;let r;try{r=spawnSync(executable,args,{encoding:'utf8',windowsHide:true,...(descriptor!==null?{stdio:['ignore',descriptor,descriptor]}:{})});}finally{if(descriptor!==null)fsSync.closeSync(descriptor);}if(r.status!==0)throw Error(name+' failed: '+(r.error?.message||'')+(r.stdout||'')+(r.stderr||'')+(descriptor!==null?fsSync.readFileSync(log,'utf8'):''));return r.stdout;}
let started=false;
try{
 run('initdb',['-D',directory,'-U','fixture','--auth=trust','--encoding=UTF8','--locale=C']);
 try{run('pg_ctl',['-D',directory,'-l',path.join(directory,'server.log'),'-o','-h 127.0.0.1 -p '+port+' -F','-w','start']);}catch(error){
  // Some managed Windows tokens cannot be restricted further by pg_ctl.
  // Run the same isolated server directly under the current sandbox token.
  if(!error.message.includes('could not create restricted token'))throw error;
  const descriptor=fsSync.openSync(path.join(directory,'server.log'),'a');
  const child=spawn(path.join(bin,'postgres'+(process.platform==='win32'?'.exe':'')),['-D',directory,'-h','127.0.0.1','-p',String(port),'-F'],{windowsHide:true,detached:true,stdio:['ignore',descriptor,descriptor]});child.unref();fsSync.closeSync(descriptor);
  let ready=false;for(let attempt=0;attempt<50;attempt++){try{run('psql',['-h','127.0.0.1','-p',String(port),'-U','fixture','-d','postgres','-c','SELECT 1']);ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}if(!ready)throw Error('Isolated PostgreSQL startup failed');
 }started=true;
 const url='postgresql://fixture@127.0.0.1:'+port+'/postgres';await fs.writeFile('scratch/redirect-db.json',JSON.stringify({directory,port,url,bin}));
 run('psql',['-h','127.0.0.1','-p',String(port),'-U','fixture','-d','postgres','-v','ON_ERROR_STOP=1','-f','prisma/migrations/20261014000000_search_redirects/migration.sql']);
 console.log('Isolated PostgreSQL started and migration applied.');
}catch(error){if(started)run('pg_ctl',['-D',directory,'-m','fast','-w','stop']);throw error;}
