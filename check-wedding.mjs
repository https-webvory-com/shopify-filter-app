async function run() {
  const url = "http://52.52.183.81:7700/indexes/products/search";
  const headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8="
  };

  // Get top scoring product and check its collections
  const res1 = await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({
      q: "R&M Richards 358260 Plus Size Black Gown Evening Mother of the Bride",
      limit: 1,
      attributesToRetrieve: ["id", "title", "bestSellingScore", "collections", "collection_titles"]
    })
  });
  const data1 = await res1.json();
  const top = data1.hits[0];
  console.log("=== TOP SCORING PRODUCT ===");
  console.log(`Title: ${top.title}`);
  console.log(`Score: ${top.bestSellingScore}`);
  console.log(`Collections count: ${top.collections?.length}`);
  console.log(`Collection_titles:`, top.collection_titles);
  // Show first 5 collections
  console.log(`First 5 collections:`, top.collections?.slice(0, 5));

  console.log("\n=== Checking collection 2747138076 ===");
  // Check if this collection exists in the data at all
  const res2 = await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({
      q: "",
      filter: [`collections = 'gid://shopify/Collection/2747138076'`],
      sort: ["bestSellingScore:desc"],
      limit: 3,
      attributesToRetrieve: ["id", "title", "bestSellingScore"]
    })
  });
  const data2 = await res2.json();
  console.log(`Results in collection 2747138076: ${data2.estimatedTotalHits}`);

  // Check SoBooster JSON - that product 15290791428467 had collections with 2747138076
  // Let's check if this product is in Meilisearch  
  console.log("\n=== Check product 15290791428467 ===");
  const res3 = await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({
      q: "",
      filter: [`collections = 'gid://shopify/Collection/15290791428467'`],
      limit: 0,
      attributesToRetrieve: []
    })
  });
  const data3 = await res3.json();
  console.log("Filter with 15290791428467 as collection:", data3.estimatedTotalHits);
}

run();
