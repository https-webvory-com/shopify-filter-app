import test from 'node:test';
import assert from 'node:assert/strict';
import {withHeldEmbeddingsForIndex} from '../../app/utils/embeddingHold.js';

test('quota hold preserves existing vectors while allowing product fields to update',async()=>{
  const original=[{id:'1',title:'Updated dress'}];
  const index={getSettings:async()=>({embedders:{openai:{source:'rest'}}})};
  const held=await withHeldEmbeddingsForIndex(index,original,'false');
  assert.deepEqual(held,[{id:'1',title:'Updated dress',_vectors:{openai:{regenerate:false}}}]);
  assert.deepEqual(original,[{id:'1',title:'Updated dress'}]);
});

test('quota hold leaves indexes without OpenAI and normal indexing untouched',async()=>{
  const documents=[{id:'2',title:'Dress'}];
  const index={getSettings:async()=>({embedders:{}})};
  assert.equal(await withHeldEmbeddingsForIndex(index,documents,'false'),documents);
  assert.equal(await withHeldEmbeddingsForIndex({getSettings:()=>{throw Error('not needed');}},documents,'true'),documents);
});
