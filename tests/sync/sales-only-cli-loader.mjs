const fixtures={
  '../app/db.server.js': `export default {
    syncJob:{findFirst:async()=>null},
    $disconnect:async()=>console.log('DB_DISCONNECTED'),
  };`,
  '../app/services/orders.server.js': `
    globalThis.__redis={disconnect:()=>console.log('REDIS_DISCONNECTED')};
    export async function syncHistoricalOrders(){
      console.log('SALES_ROLE',process.env.CFP_WORKER_MODE);
      return process.env.TEST_SALES_FAILURE!=='true';
    }`,
};
export async function resolve(specifier,context,nextResolve){
  if(Object.hasOwn(fixtures,specifier))return {url:'data:text/javascript,'+encodeURIComponent(fixtures[specifier]),shortCircuit:true};
  return nextResolve(specifier,context);
}
