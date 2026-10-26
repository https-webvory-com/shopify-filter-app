import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
const run=(command,args)=>{
  const result=spawnSync(command,args,{windowsHide:true,encoding:'utf8'});
  if(result.status!==0)throw Error(result.stderr||result.stdout||'Database fixture failed');
};
let started=false,db;
try{
  run(process.execPath,['tests/search-redirect/start-postgres.mjs']);started=true;
  const config=JSON.parse(await fs.readFile('scratch/redirect-db.json','utf8'));
  if(new URL(config.url).hostname!=='127.0.0.1'||!path.resolve(config.directory).startsWith(path.resolve('scratch')+path.sep))throw Error('Refusing non-fixture database');
  run(path.join(config.bin,process.platform==='win32'?'psql.exe':'psql'),['-h','127.0.0.1','-p',String(config.port),'-U','fixture','-d','postgres','-v','ON_ERROR_STOP=1','-f','prisma/migrations/20261026000000_market_availability/migration.sql']);
  db=new PrismaClient({datasources:{db:{url:config.url}}});
  const shop='country-fixture.myshopify.com',other='other-country-fixture.myshopify.com';
  await db.marketStorefrontConnection.create({data:{shop,accessToken:'test-only-token',countries:['IN','US','GB'],locale:'en'}});
  const select={countries:true,updatedAt:true};
  const publicConnection=await db.marketStorefrontConnection.findUnique({where:{shop},select});
  assert.equal(publicConnection.countries.length,3);assert.equal(Object.hasOwn(publicConnection,'accessToken'),false);
  for(const [tenant,country,ids]of [[shop,'IN',['2']],[shop,'US',['1','2']],[other,'IN',['9']]])await db.marketAvailabilitySnapshot.create({data:{shop:tenant,country,ids,connection:'fixture',epoch:0,version:country+tenant}});
  assert.deepEqual((await db.marketAvailabilitySnapshot.findUnique({where:{shop_country:{shop,country:'IN'}}})).ids,['2']);
  assert.deepEqual((await db.marketAvailabilitySnapshot.findUnique({where:{shop_country:{shop,country:'US'}}})).ids,['1','2']);
  await db.marketAvailabilitySnapshot.update({where:{shop_country:{shop,country:'IN'}},data:{ids:['1','2'],epoch:1,version:'restocked'}});
  assert.equal((await db.marketAvailabilitySnapshot.findUnique({where:{shop_country:{shop:other,country:'IN'}}})).version,'IN'+other);
  assert.equal((await db.marketAvailabilitySnapshot.findUnique({where:{shop_country:{shop,country:'US'}}})).epoch,0);
  await db.marketAvailabilitySnapshot.deleteMany({where:{shop}});
  assert.equal(await db.marketAvailabilitySnapshot.count(),1);
  console.log('PASS migration, saved country inventory, restock update, tenant isolation and token-free public metadata');
}finally{
  await db?.$disconnect();
  if(started)run(process.execPath,['tests/search-redirect/stop-postgres.mjs']);
}
