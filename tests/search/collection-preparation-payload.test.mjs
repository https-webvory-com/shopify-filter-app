import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePreparation,decodePreparation} from '../../app/utils/collectionPreparationPayload.js';
import {publicRetentionLimit,publicRetentionBytes} from '../../app/utils/collectionPreparation.js';

test('catalog rankings compress losslessly including frozen order and merchandising metadata',()=>{
 const value={ids:Array.from({length:23000},(_,i)=>String(15000000000000+i)),metadata:{'15000000000001':{merchandisingScore:1000,merchandisingImage:'https://example.test/image.jpg'}},preparedAt:12345,productRevision:'7'};
 const raw=encodePreparation(value);
 assert.ok(raw.startsWith('z1:'));assert.ok(Buffer.byteLength(raw)<Buffer.byteLength(JSON.stringify(value))/3);
 assert.deepEqual(decodePreparation(raw),value);
 assert.ok(publicRetentionLimit>40);assert.equal(publicRetentionBytes,64*1024*1024);
});

test('legacy and small ranking payloads remain readable; corrupt compressed payloads are rejected',()=>{
 const value={ids:['2','1'],metadata:{}};
 assert.deepEqual(decodePreparation(JSON.stringify(value)),value);
 assert.deepEqual(decodePreparation(encodePreparation(value)),value);
 assert.throws(()=>decodePreparation('z1:broken'));
});
