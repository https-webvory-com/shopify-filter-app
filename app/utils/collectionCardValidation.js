import {readRankedCollectionPage} from './rankedCollectionPage.js';
import {collectionPageFingerprint} from './collectionResponse.js';

// A preview only displays five products. Validate those exact documents now;
// the complete page keeps its own 25-document validation on the follow-up.
// Older snapshots without a preview fingerprint retain full validation.
export async function validateCollectionCardDocuments(index,entry,prepared,{preview=false,batchOwner=index,onValidated=()=>{}}={}){
 const head=preview&&typeof entry.previewValidationFingerprint==='string';
 const result=await readRankedCollectionPage(index,{ids:prepared.ids,page:1,limit:head?5:25,
  shop:entry.shop,batchOwner,attributes:entry.attributes});
 const valid=collectionPageFingerprint(result.hits)===(head?entry.previewValidationFingerprint:entry.validationFingerprint);
 if(valid)onValidated(head?5:25);
 return valid;
}
