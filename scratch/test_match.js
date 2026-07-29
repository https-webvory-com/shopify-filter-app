import { applyMerchandisingRules } from '../app/services/merchandising.server.js';

const product = {
  "id": "gid://shopify/Product/7222430662717",
  "title": "Fitted Off Shoulder Sequin Prom Formal Dress",
  "handle": "dylan-davids-fitted-off-shoulder-sequin-prom-formal-dress",
  "vendor": "The Dress Outlet",
  "productType": "Prom Dresses",
  "priceMin": 149.99,
  "priceMax": 149.99,
  "tags": [
      "2XL", "3XL", "4XL", "Best of Best", "Best Seller", "BestFormal", "BestMermaid", "BestMOB", "BestPlus", "BestProm", "BestSequins", "Black", "Burgundy", "Charcoal", "Cranberry", "Dark Gold", "Emerald Green", "Gold", "L", "Long", "M", "Mauve", "Mother of the Bride", "Plus Size", "Prom", "Rose Gold", "Royal Blue", "S", "TopFormal", "TopMermaid", "TopMOB", "TopPlus", "TopProm", "XL", "XS"
  ],
  "images": [
      "https://cdn.shopify.com/s/files/1/1109/3312/files/1319_Gold_1.jpg?v=1773368076"
  ],
  "status": "active",
  "options": [
      {
          "name": "Color",
          "values": ["Dark Gold", "Emerald Green", "Charcoal", "Rose Gold", "Mauve", "Black", "Cranberry", "Navy"]
      },
      {
          "name": "Size",
          "values": ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"]
      }
  ],
  "merchandisingImage": null,
  "variants": [
      {
          "id": "gid://shopify/ProductVariant/62619788640627",
          "price": 149.99,
          "available": true,
          "option1": "Dark Gold",
          "option2": "XS",
          "imageUrl": "https://cdn.shopify.com/s/files/1/1109/3312/files/1319_Gold_1.jpg?v=1773368076"
      },
      {
          "id": "gid://shopify/ProductVariant/52454383649139",
          "price": 149.99,
          "available": true,
          "option1": "Black",
          "option2": "XS",
          "imageUrl": "https://cdn.shopify.com/s/files/1/1109/3312/files/1_81ff5ebb-8eb6-4b44-825a-935c3a7092de.jpg?v=1777268750"
      }
  ]
};

const rule = {
  conditions: [
    {
      action: "Boost",
      field: "Color (product option)",
      value: "Black"
    }
  ]
};

const res = applyMerchandisingRules([product], rule, "best-selling", null, []);
console.log("Resulting Product Merchandising Image:");
console.log(res[0].merchandisingImage);
console.log("Resulting Product Merchandising Score:", res[0].merchandisingScore);
