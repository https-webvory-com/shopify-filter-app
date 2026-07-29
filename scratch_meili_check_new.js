import fetch from 'node-fetch';
async function check() {
  const meiliHost = "http://52.52.183.81:7700";
  const masterKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";
  const index = "products";
  
  const productId = "15023349465459";

  const response = await fetch(`${meiliHost}/indexes/${index}/documents/${productId}`, {
    headers: { 'Authorization': `Bearer ${masterKey}` }
  });
  
  if (!response.ok) {
     console.error("Failed to fetch product:", response.status, await response.text());
     return;
  }
  
  const product = await response.json();
  console.log("Product:", product.title);
  console.log("Options:", JSON.stringify(product.options, null, 2));
  console.log("Variants with Red in them:");
  const redVariants = product.variantPrices.filter(v => 
    (v.option1 && v.option1.toLowerCase().includes('red')) ||
    (v.option2 && v.option2.toLowerCase().includes('red')) ||
    (v.option3 && v.option3.toLowerCase().includes('red'))
  );
  console.log(JSON.stringify(redVariants, null, 2));
}
check();
