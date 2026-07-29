import fetch from 'node-fetch';
import { applyMerchandisingRules } from '../app/services/merchandising.server.js';

async function test() {
  const url = 'https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN&cb=' + Date.now();
  const res = await fetch(url);
  const data = await res.json();

  const target = data.products.find(x => x.id.includes('15285087895923'));
  console.log("Product Title:", target.title);
  console.log("MerchandisingImage from API:", target.merchandisingImage);
  console.log("Variants Count:", target.variants ? target.variants.length : 0);
  
  if (target.variants) {
    const blackVar = target.variants.find(v => (v.option1||'').toLowerCase() === 'black' || (v.option2||'').toLowerCase() === 'black' || (v.option3||'').toLowerCase() === 'black');
    console.log("Black Variant found:", JSON.stringify(blackVar, null, 2));
  }
}

test();
