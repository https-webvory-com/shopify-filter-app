import fs from 'node:fs/promises';
import path from 'node:path';
import {transform} from 'esbuild';

// Prepare files only. Shopify uploads remain an explicit, theme-scoped action.
const [source,output]=process.argv.slice(2);
if(!source||!output)throw Error('Usage: node scripts/prepare-collection-theme-start.mjs layout.liquid output-directory');
const original=await fs.readFile(source,'utf8');
const loader=await fs.readFile('extensions/theme-extension/assets/collectionLoading.js','utf8');
const block=await fs.readFile('extensions/theme-extension/blocks/collection_loading.liquid','utf8');
const metadata=block.match(/  <meta name="cfp-collection-context"[\s\S]*?data-customer-tags=.*?>/)?.[0];
if(!metadata||!original.includes('<meta charset="utf-8">')||!original.includes('<main id="main" class="anchor">'))throw Error('Unsupported layout; inspect before applying');
const scope="template.name == 'collection' and collection and content_for_layout contains 'cfp-v1-app-container'";
const snippet="{% if "+scope+" %}\n<link rel=\"preconnect\" href=\"https://aisearchfilter.webvory.com\" crossorigin>\n<link rel=\"preconnect\" href=\"https://cdn.shopify.com\" crossorigin>\n"+metadata+'\n<script>'+(await transform(loader,{minify:true,target:'es2020'})).code+'</script>\n{% endif %}\n';
let layout=original;
if(!layout.includes("render 'cfp-early-request'"))layout=layout.replace('<meta charset="utf-8">','<meta charset="utf-8">\n{% if template.name == \'collection\' and collection %}<link rel="preload" as="style" href="{{ \'theme.css\' | asset_url }}" fetchpriority="high">{% endif %}\n{% render \'cfp-early-request\' %}');
if(!layout.includes('id="cfp-first-row-anchor"'))layout=layout.replace('<main id="main" class="anchor">','<main id="main" class="anchor">\n{% if '+scope+' %}<div id="cfp-first-row-anchor"></div>{% endif %}');
await fs.mkdir(path.join(output,'layout'),{recursive:true});await fs.mkdir(path.join(output,'snippets'),{recursive:true});
await fs.writeFile(path.join(output,'layout/theme.liquid'),layout);
await fs.writeFile(path.join(output,'snippets/cfp-early-request.liquid'),snippet);
console.log(JSON.stringify({prepared:true,output,files:['layout/theme.liquid','snippets/cfp-early-request.liquid']}));
