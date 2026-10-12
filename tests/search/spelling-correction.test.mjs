import test from 'node:test';
import assert from 'node:assert/strict';
import {spellingCorrection} from '../../app/utils/spellingCorrection.js';
const hits=[{title:'Blue Plus Size Dress',_formatted:{title:'Blue Plus Size <em>Dress</em>'}}];
test('multiword descriptions are never replaced by one highlighted word',()=>{
 assert.equal(spellingCorrection('blue plus size dress for wedding',hits),null);
 assert.equal(spellingCorrection('blue dress',hits),null);
});
test('exact matches and prefix completion are not spelling errors',()=>{
 assert.equal(spellingCorrection('dress',hits),null);
 assert.equal(spellingCorrection('dres',hits),null);
});
test('a close single-word typo can be corrected while unrelated words cannot',()=>{
 assert.equal(spellingCorrection('drees',hits),'dress');
 assert.equal(spellingCorrection('wedding',hits),null);
 assert.equal(spellingCorrection('drees',hits,1),null);
});
