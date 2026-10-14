import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
await fs.mkdir('scratch',{recursive:true});
const source=(await fs.readFile('prisma/schema.prisma','utf8')).replace('provider = "prisma-client-js"','provider = "prisma-client-js"\n  output = "./banner-prisma"');
await fs.writeFile('scratch/banner-schema.prisma',source);
const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','generate','--schema','scratch/banner-schema.prisma'],{windowsHide:true,stdio:'inherit'});
if(result.status!==0)throw Error('Could not generate the isolated banner fixture client');
