import {readRankedCollectionPage} from './rankedCollectionPage.js';
import {collectionPageFingerprint} from './collectionResponse.js';

// A legacy image/title preview only displays five products. Validate those exact documents now;
// the complete page keeps its own validation on the follow-up. Background
// publication validates all 50 documents before exposing either 25-card page.
// Complete-card clients and older snapshots without a preview fingerprint use
// full page validation; the card store never marks them as legacy previews.
export async function validateCollectionCardDocuments(index,entry,prepared,{preview=false,batchOwner=index,onValidated=()=>{}}={}){
 const head=preview&&typeof entry.previewValidationFingerprint==='string';
 const pageSize=entry.payload?.products?.length>25?50:25;
 const result=await readRankedCollectionPage(index,{ids:prepared.ids,page:1,limit:head?5:pageSize,
  shop:entry.shop,batchOwner,attributes:entry.attributes});
 const valid=collectionPageFingerprint(result.hits)===(head?entry.previewValidationFingerprint:entry.validationFingerprint);
 if(valid)onValidated(head?5:pageSize);
 return valid;
}
