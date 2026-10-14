import fs from 'node:fs/promises';import vm from 'node:vm';import path from 'node:path';import {transform} from 'esbuild';import {PrismaClient} from '@prisma/client';import * as helpers from '../../app/utils/searchRedirect.js';
const config=JSON.parse(await fs.readFile('scratch/redirect-db.json','utf8'));
if(new URL(config.url).hostname!=='127.0.0.1'||Number(new URL(config.url).port)!==config.port||!path.resolve(config.directory).startsWith(path.resolve('scratch')+path.sep))throw Error('Redirect tests require an isolated local fixture database');
export const db=new PrismaClient({datasources:{db:{url:config.url}}});
export async function load(file,mocks){const code=(await transform(await fs.readFile(file,'utf8'),{loader:'jsx',format:'cjs'})).code;const ctx={module:{exports:{}},exports:{},URL,Response,console:{error(){}},require:name=>{if(!(name in mocks))throw Error('Unexpected import '+name);return mocks[name];}};vm.runInNewContext(code,ctx);return ctx.module.exports;}
export const service=await load('app/services/searchRedirect.server.js',{'../db.server':{__esModule:true,default:db},'../utils/searchRedirect.js':helpers});
export const shop='fixture.myshopify.com';
export function form(values){const f=new FormData();for(const [key,value]of Object.entries(values))f.set(key,value);return f;}
export const admin=await load('app/routes/app.search.redirects.jsx',{'react-router':{},react:{},'@shopify/shopify-app-react-router/server':{boundary:{}},'../shopify.server':{authenticate:{admin:async()=>({session:{shop}})}},'../db.server':{__esModule:true,default:db},'../services/searchRedirect.server.js':service,'../utils/searchRedirect.js':helpers});
export const api=await load('app/routes/api.search-redirect.jsx',{'react-router':{data:(v,i)=>Response.json(v,i)},'../services/searchRedirect.server.js':service,'../services/rateLimiter.server':{rateLimit:async()=>true}});
