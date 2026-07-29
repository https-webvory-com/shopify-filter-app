import fetch from 'node-fetch';
import { applyMerchandisingRules } from '../app/services/merchandising.server.js';

async function test() {
  const url = 'https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN&cb=' + Date.now();
  const res = await fetch(url);
  const data = await res.json();

  const p6 = data.products[5]; // Product at index 5 (6th product on grid)
  console.log("6th Product Title:", p6.title);
  console.log("6th Product Options:", JSON.stringify(p6.options, null, 2));
  console.log("6th Product Variants Count:", p6.variants ? p6.variants.length : 0);
  if (p6.variants && p6.variants.length > 0) {
    console.log("First 3 Variants:", JSON.stringify(p6.variants.slice(0, 3), null, 2));
  }

  const mockRule = {
    conditions: [
      {
        action: "Boost",
        field: "Color (product option)",
        value: "Black"
      }
    ]
  };

  const result = applyMerchandisingRules([p6], mockRule, "best-selling", null, []);
  console.log("Score for 6th Product:", result[0].merchandisingScore);
}

test();
