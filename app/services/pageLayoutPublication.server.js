import {unauthenticated} from '../shopify.server.js';
import {collectionLayoutSettings} from '../utils/collectionLayoutSettings.js';

const published = new Map();
// Only these public presentation values go into Liquid. No customer/catalog data.
export async function publishPageLayout(shop, settings, {admin, force=false}={}) {
  const layout=collectionLayoutSettings({...settings?.integrations,...settings});
  const value=JSON.stringify(layout),cached=published.get(shop);
  if(!force&&cached?.value===value&&Date.now()-cached.at<60000)return layout;
  admin??=(await unauthenticated.admin(shop)).admin;
  const read=await admin.graphql(`query PageLayoutInstallation {
    currentAppInstallation { id metafield(namespace:"cfp_layout",key:"page_spacing") { value compareDigest } }
  }`);
  const result=await read.json(),installation=result.data?.currentAppInstallation;
  if(!read.ok||result.errors?.length||!installation?.id)throw Error('Unable to read initial page spacing');
  if(installation.metafield?.value!==value){
    const response=await admin.graphql(`mutation PublishPageLayout($metafields:[MetafieldsSetInput!]!) {
      metafieldsSet(metafields:$metafields) { userErrors { message } }
    }`,{variables:{metafields:[{ownerId:installation.id,namespace:'cfp_layout',key:'page_spacing',type:'json',value,compareDigest:installation.metafield?.compareDigest??null}]}});
    const body=await response.json();
    if(!response.ok||body.errors?.length||!body.data?.metafieldsSet||body.data.metafieldsSet.userErrors?.length)throw Error('Unable to publish initial page spacing');
  }
  published.set(shop,{value,at:Date.now()});
  return layout;
}
