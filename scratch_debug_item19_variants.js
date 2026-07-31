import { Meilisearch } from "meilisearch";

const meiliHost = "https://meilisearch.webvory.com";
const meiliKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";

const client = new Meilisearch({
  host: meiliHost,
  apiKey: meiliKey,
});

async function run() {
  const index = client.index("products");
  const doc = await index.getDocument("15454552686963"); // Short Strapless Corset Cocktail Dress

  console.log("=== ITEM 19 DETAILS ===");
  console.log("Title:", doc.title);
  console.log("Options:", JSON.stringify(doc.options));
  console.log("option_Color:", doc.option_Color);
  console.log("variantPrices count:", doc.variantPrices?.length);
  (doc.variantPrices || []).forEach((v, idx) => {
    console.log(` Variant ${idx + 1}: opt1="${v.option1}", opt2="${v.option2}", opt3="${v.option3}", img=${v.imageUrl}`);
  });
}

run();
