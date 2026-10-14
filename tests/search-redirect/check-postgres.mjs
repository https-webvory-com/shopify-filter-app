import {db,service,shop,form} from './layer.mjs';import assert from 'node:assert/strict';
try{
 await db.searchRedirect.deleteMany({where:{shop}});
 await service.saveSearchRedirect(shop,form({intent:'create',queries:'Shipping\nshipping policy',targetUrl:'/policies/shipping-policy',isActive:'true'}));
 const first=await db.searchRedirect.findFirst({where:{shop}});assert.equal(await service.findSearchRedirect(shop,' SHIPPING '),'/policies/shipping-policy');
 await service.saveSearchRedirect(shop,form({intent:'create',queries:'sale',targetUrl:'/collections/sale',isActive:'true'}));
 await assert.rejects(service.saveSearchRedirect(shop,form({intent:'update',id:first.id,queries:'sale',targetUrl:'/wrong',isActive:'true'})),{code:'P2002'});
 assert.equal(await service.findSearchRedirect(shop,'shipping'),'/policies/shipping-policy');console.log('PASS PostgreSQL duplicate conflict rolls back query deletion and URL edit');
 await service.saveSearchRedirect(shop,form({intent:'update',id:first.id,queries:'delivery',targetUrl:'/pages/delivery',isActive:'true'}));assert.equal(await service.findSearchRedirect(shop,'shipping'),null);assert.equal(await service.findSearchRedirect(shop,'delivery'),'/pages/delivery');
 await service.saveSearchRedirect(shop,form({intent:'toggle',id:first.id,isActive:'false'}));assert.equal(await service.findSearchRedirect(shop,'delivery'),null);await service.saveSearchRedirect(shop,form({intent:'toggle',id:first.id,isActive:'true'}));assert.equal(await service.findSearchRedirect(shop,'delivery'),'/pages/delivery');
 await service.saveSearchRedirect(shop,form({intent:'delete',id:first.id}));assert.equal(await db.searchRedirectQuery.count({where:{redirectId:first.id}}),0);console.log('PASS PostgreSQL create/edit/enable/disable/delete and cascade');
 const results=await Promise.allSettled([1,2].map(()=>service.saveSearchRedirect(shop,form({intent:'create',queries:'concurrent',targetUrl:'/pages/concurrent',isActive:'true'}))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='P2002').length,1);console.log('PASS PostgreSQL concurrent duplicate protection');
 const rule=await db.searchRedirect.findFirst({where:{shop}});await assert.rejects(service.saveSearchRedirect('other.myshopify.com',form({intent:'update',id:rule.id,queries:'stolen',targetUrl:'/wrong',isActive:'true'})),{code:'P2025'});assert.equal(await service.findSearchRedirect('other.myshopify.com','sale'),null);console.log('PASS PostgreSQL tenant isolation');
 await db.searchRedirect.deleteMany({where:{shop}});
}finally{await db.$disconnect();}
