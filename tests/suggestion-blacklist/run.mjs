import {spawnSync} from 'node:child_process';
function run(file){const result=spawnSync(process.execPath,[file],{windowsHide:true,stdio:'inherit'});if(result.status!==0)throw Error('Blacklist check failed: '+file);}
let started=false;
try {
  run('tests/search-redirect/start-postgres.mjs');started=true;
  run('tests/suggestion-blacklist/check-postgres.mjs');
  run('tests/suggestion-blacklist/run-headless.mjs');
} finally {
  if(started)run('tests/search-redirect/stop-postgres.mjs');
}
