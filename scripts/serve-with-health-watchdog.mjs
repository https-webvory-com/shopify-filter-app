import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {watchWebHealth} from './lib/web-health-watchdog.mjs';

const require=createRequire(import.meta.url);
const cli=join(dirname(require.resolve('@react-router/serve/package.json')),'bin.js');
const child=spawn(process.execPath,[cli,...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});
let terminating=false,forceTimer;
const terminate=()=>{
 if(terminating)return;terminating=true;stop();child.kill('SIGTERM');
 forceTimer=setTimeout(()=>child.kill('SIGKILL'),10000);
};
const stop=watchWebHealth({url:`http://127.0.0.1:${process.env.PORT||3000}/healthz`,
 onFailure:count=>console.error(`CFP: Web health probe failed (${count}/3)`),
 onUnresponsive:()=>{console.error('CFP: Web process unresponsive; exiting for container recovery');terminate();},
});
process.on('SIGTERM',terminate);process.on('SIGINT',terminate);
child.on('error',error=>{console.error('CFP: Web process could not start:',error.message);stop();process.exitCode=1;});
child.on('exit',(code)=>{stop();clearTimeout(forceTimer);process.exitCode=terminating?1:code??1;});
