import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionTitleMatchesSearch} from '../../app/utils/collectionSearchText.js';

test('collection search finds the real UK title with spaces, hyphens and Unicode spacing',()=>{
 const title='A-Line Prom Dresses\u00a0';
 for(const query of ['a line prom dresses','A-Line Prom Dresses','  A   LINE   PROM DRESSES  ','a\u2011line prom dresses','a\u00a0line prom dresses','a line prom',''])assert.equal(collectionTitleMatchesSearch(title,query),true,query);
 assert.equal(collectionTitleMatchesSearch(title,'Mermaid Prom Dresses'),false);
 assert.equal(title,'A-Line Prom Dresses\u00a0');
});

test('collection search preserves letters, numbers and words across punctuation boundaries',()=>{
 assert.equal(collectionTitleMatchesSearch('Girls’ Dresses','girls dresses'),true);
 assert.equal(collectionTitleMatchesSearch('Robes de Soirée','robes de soirée'),true);
 assert.equal(collectionTitleMatchesSearch('2026 Prom Dresses','2025 prom'),false);
 assert.equal(collectionTitleMatchesSearch('Prom Dresses','promdresses'),false);
});
