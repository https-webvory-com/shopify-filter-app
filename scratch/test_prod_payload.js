import fetch from 'node-fetch';
import { applyMerchandisingRules } from '../app/services/merchandising.server.js';

async function test() {
  const url = 'https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN&cb=' + Date.now();
  const res = await fetch(url);
  const data = await res.json();

  const prodCD0241 = data.products.find(x => x.id.includes('15138310390131'));
  console.log("CD0241 Title:", prodCD0241.title);
  console.log("CD0241 Options:", JSON.stringify(prodCD0241.options, null, 2));

  // Let's test running our updated local applyMerchandisingRules function on prodCD0241!
  const mockRule = {
    conditions: [
      {
        action: "Boost",
        field: "Color (product option)",
        value: "Black"
      }
    ]
  };

  const result = applyMerchandisingRules([prodCD0241], mockRule, "best-selling", null, []);
  console.log("Local applyMerchandisingRules Result for CD0241:");
  console.log("merchandisingImage:", result[0].merchandisingImage);
  console.log("merchandisingScore:", result[0].merchandisingScore);
}

test();
