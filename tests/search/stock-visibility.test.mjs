import test from "node:test";
import assert from "node:assert/strict";
import { availablePins } from "../../app/utils/availablePins.server.js";

const shop="fixture.myshopify.com";
const gid=id=>"gid://shopify/Product/"+id;
test("pin editors omit sold-out and missing products while retaining available pin order and images",async()=>{
  const prisma={product:{findMany:async({where})=>{assert.equal(where.shop,shop);assert.equal(where.variants.some.available,true);return [{id:gid(2)},{id:gid(4)}];}}};
  const pins=[{id:gid(1)},{id:gid(4),image:"black.jpg"},{id:gid(2)}];
  assert.deepEqual(await availablePins(prisma,shop,JSON.stringify(pins)),[pins[1],pins[2]]);
  assert.deepEqual(await availablePins(prisma,shop,"invalid JSON"),[]);
});

test('saved pins retain out-of-stock products when the store allows them, while missing products stay excluded',async()=>{
 const pins=[{id:gid(1),image:'saved.jpg'},{id:gid(2)},{id:gid(3)}];
 const prisma={product:{findMany:async({where})=>{assert.equal(where.shop,shop);assert.equal(where.variants,undefined);assert.deepEqual(where.status,{equals:'active',mode:'insensitive'});return [{id:gid(1)},{id:gid(2)}];}}};
 assert.deepEqual(await availablePins(prisma,shop,pins,{stockOnly:false}),pins.slice(0,2));
});
