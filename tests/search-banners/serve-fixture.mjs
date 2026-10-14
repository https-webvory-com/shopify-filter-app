import fs from 'node:fs/promises';
import {createBannerServer} from './server.mjs';
const fixture=await createBannerServer();
await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port;
await fs.writeFile('scratch/banner-fixture.json',JSON.stringify({origin,pid:process.pid}));
console.log('Isolated banner fixture: '+origin);
const marker='scratch/banner-fixture-stop-'+process.pid;
const timer=setInterval(async()=>{if(await fs.access(marker).then(()=>true,()=>false)){clearInterval(timer);await fixture.dispose();console.log('Banner fixture stopped.');}},500);
