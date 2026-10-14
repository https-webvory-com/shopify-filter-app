import {spawnSync} from 'node:child_process';
const run=file=>{const result=spawnSync(process.execPath,[file],{windowsHide:true,stdio:'inherit'});if(result.status!==0)throw Error('Banner check failed: '+file);};
let started=false;
try {run('tests/search-banners/prepare-client.mjs');run('tests/search-redirect/start-postgres.mjs');started=true;run('tests/search-banners/check-postgres.mjs');if(process.argv.includes('--browser'))run('tests/search-banners/run-headless.mjs');}
finally {if(started)run('tests/search-redirect/stop-postgres.mjs');}
