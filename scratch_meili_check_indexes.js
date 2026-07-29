import fetch from 'node-fetch';
async function check() {
  const meiliHost = "http://52.52.183.81:7700";
  const masterKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";

  const response = await fetch(`${meiliHost}/indexes`, {
    headers: { 'Authorization': `Bearer ${masterKey}` }
  });
  
  if (!response.ok) {
     console.error("Failed to fetch indexes:", response.status, await response.text());
     return;
  }
  
  const indexes = await response.json();
  console.log("Indexes:", indexes.results.map(i => i.uid).join(", "));
}
check();
