import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

for(const [label,failure,expectedExit] of [['success',false,0],['failed sync',true,1]]){
  test(`sales-only CLI exits after ${label} without starting workers`,()=>{
    const child=spawnSync(process.execPath,[
      '--experimental-loader',new URL('./sales-only-cli-loader.mjs',import.meta.url).href,
      'scripts/run-sales-only.mjs','fixture.myshopify.com',
    ],{cwd:process.cwd(),encoding:'utf8',timeout:10000,
      env:{...process.env,CFP_WORKER_MODE:'worker',TEST_SALES_FAILURE:String(failure)}});
    assert.equal(child.status,expectedExit,child.stderr||child.error?.message);
    assert.match(child.stdout,/SALES_ROLE standalone/);
    assert.match(child.stdout,/DB_DISCONNECTED/);
    assert.match(child.stdout,/REDIS_DISCONNECTED/);
  });
}
