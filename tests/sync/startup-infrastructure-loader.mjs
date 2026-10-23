// Replace infrastructure packages only. Keep the application's ESM graph intact
// so initialization-order failures in the production bundle remain observable.
const fixtures = {
  ioredis: `import {EventEmitter} from 'node:events';
    export default class Redis extends EventEmitter {
      constructor(){super();globalThis.__startupRedis=this;}
      async get(){return null;} async keys(){return [];} async quit(){}
    }`,
  bullmq: `import {EventEmitter} from 'node:events';
    export class Queue extends EventEmitter {
      constructor(name,opts){super();this.name=name;this.opts=opts;}
      async getJob(){return null;} async add(){return {id:'fixture'};}
    }
    export class Worker extends EventEmitter {
      constructor(name,processor,opts){super();this.name=name;this.processor=processor;this.opts=opts;}
      async waitUntilReady(){} async close(){}
    }
    export class DelayedError extends Error {}`,
  '@shopify/shopify-app-session-storage-prisma':
    `export class PrismaSessionStorage {constructor(){} }`,
};
export async function resolve(specifier, context, nextResolve) {
  if (Object.hasOwn(fixtures, specifier)) {
    return {url: 'data:text/javascript,' + encodeURIComponent(fixtures[specifier]), shortCircuit: true};
  }
  return nextResolve(specifier, context);
}
