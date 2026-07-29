import fetch from 'node-fetch';
import { applyMerchandisingRules } from '../app/services/merchandising.server.js';

async function test() {
  const url = 'https://aisearchfilter.webvory.com/api/filter?shop=thedressoutlet.myshopify.com&collectionHandle=black-tie-dresses&country=IN&cb=' + Date.now();
  const res = await fetch(url);
  const data = await res.json();

  const target = data.products.find(x => x.id.includes('15285087895923'));
  
  const mockRule = {
    conditions: [
      {
        action: "Boost",
        field: "Color (product option)",
        value: "Black"
      }
    ]
  };

  const result = applyMerchandisingRules([target], mockRule, "best-selling", null, []);
  console.log("Local Engine Result for 15285087895923:");
  console.log("merchandisingImage:", result[0].merchandisingImage);
  console.log("merchandisingScore:", result[0].merchandisingScore);
}

test();
