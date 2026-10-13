import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const files=[];
for(const directory of ['tests/search','tests/webhooks','tests/sync']){
  for(const name of (await readdir(directory)).sort())if(name.endsWith('.test.mjs'))files.push(`${directory}/${name}`);
}
console.log(`Regression runtime: ${process.version}; test files: ${files.length}`);
const child=spawn(process.execPath,['--test',...files],{stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
