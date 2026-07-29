import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const product = {
    "id": "gid://shopify/Product/15138310390131",
    "title": "Long Beaded A-Line Formal Dress by LaDivine CD0241",
    "handle": "cinderella-divine-cd0241-long-beaded-a-line-formal-gown",
    "vendor": "LaDivine",
    "productType": "Formal Dresses",
    "priceMin": 289,
    "priceMax": 289,
    "tags": [
        "10", "12", "14", "16", "18", "20", "6", "8", "Backless", "Beaded", "Black Nude", "Eggplant", "English Violet", "Formal", "Gold", "Greenery", "Long", "Navy", "Number", "Plus Size", "Silver", "Smoky Blue", "V-Neck"
    ],
    "images": [
        "https://cdn.shopify.com/s/files/1/1109/3312/files/CD0241_2.jpg?v=1764944498",
        "https://cdn.shopify.com/s/files/1/1109/3312/files/CD0241-beaded-v-neck-flutter-sleeve-gown.jpg?v=1764944498",
        "https://cdn.shopify.com/s/files/1/1109/3312/files/CD0241-beaded-v-neck-flutter-sleeve-gown-2.jpg?v=1773965635"
    ],
    "options": [
        {
            "name": "Color",
            "values": [
                "Eggplant", "Black Nude", "English Violet", "Gold", "Greenery", "Navy", "Silver", "Smoky Blue"
            ]
        }
    ],
    "merchandisingImage": null,
    "variantPrices": [
        {
            "id": "52785461363059",
            "price": 289,
            "available": false,
            "option1": "Eggplant",
            "option2": "6",
            "imageUrl": "https://cdn.shopify.com/s/files/1/1109/3312/files/CD0241-beaded-v-neck-flutter-sleeve-gown.jpg?v=1764944498"
        },
        {
            "id": "52785461100915",
            "price": 289,
            "available": true,
            "option1": "Black Nude",
            "option2": "6",
            "imageUrl": "https://cdn.shopify.com/s/files/1/1109/3312/files/CD0241-beaded-v-neck-flutter-sleeve-gown-2.jpg?v=1773965635"
        }
    ]
};

async function test() {
  const shop = "thedressoutlet.myshopify.com";
  const mergedValues = await prisma.mergedValue.findMany({ where: { shop, isActive: true } });
  console.log("Merged values count for shop:", mergedValues.length);
  
  const blackRules = mergedValues.filter(m => m.targetValue.toLowerCase() === 'black');
  console.log("Black merged rules:", blackRules);
}

test().finally(() => prisma.$disconnect());
