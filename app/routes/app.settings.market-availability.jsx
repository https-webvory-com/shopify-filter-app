import {useState} from 'react';
import {useLoaderData,useFetcher,useNavigate} from 'react-router';
import {useAppBridge} from '@shopify/app-bridge-react';
import {authenticate} from '../shopify.server';
import prisma from '../db.server.js';
import {connectMarketAvailability} from '../services/marketAvailability.server.js';
export const loader=async({request})=>{
  const {session}=await authenticate.admin(request);
  const connection=await prisma.marketStorefrontConnection.findUnique({where:{shop:session.shop},select:{countries:true,updatedAt:true}});
  return {connection};
};
export const action=async({request})=>{
  const {session,admin}=await authenticate.admin(request);
  try{return {success:true,...await connectMarketAvailability(session.shop,admin)};}
  catch(error){
    const safe=/^(Approve the Storefront|Unable to create the Storefront|Unable to verify enabled|The Storefront connection cannot see|Shopify country availability)/.test(error.message);
    return Response.json({error:safe?error.message:'Unable to connect country availability. Please retry.'},{status:400});
  }
};
export default function MarketAvailability(){
  const {connection}=useLoaderData(),fetcher=useFetcher(),shopify=useAppBridge(),navigate=useNavigate();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const connect=async()=>{
    if(busy||fetcher.state!=='idle')return;
    setBusy(true);setError('');
    try{
      const result=await shopify.scopes.request(['unauthenticated_read_product_listings']);
      if(result.result!=='granted-all'||!result.detail?.granted?.includes('unauthenticated_read_product_listings'))throw Error('Approve read-only product listings access to enable country stock.');
      fetcher.submit({intent:'connect'},{method:'POST'});
    }catch(error){setError(error.message);}finally{setBusy(false);}
  };
  return <s-page heading="Country availability">
    <button onClick={()=>navigate('/app/settings/general')}>Back to General settings</button>
    <s-section heading="Show products available in the shopper’s country">
      <p>Collection Filter Pro prepares a separate collection page for each enabled country. Products unavailable in that country are hidden, including when “Show only in-stock products” is off.</p>
      <p>{connection?'Connected for '+connection.countries.length+' countries. Stock updates refresh saved collection pages in the background.':'Connect Shopify’s read-only Storefront access to enable country availability. Shopify will ask you to approve the permission; no API key is needed.'}</p>
      <button type="button" disabled={busy||fetcher.state!=='idle'} onClick={connect}>{busy||fetcher.state!=='idle'?'Connecting…':connection?'Refresh connection and countries':'Connect country availability'}</button>
      {(error||fetcher.data?.error)&&<p role="alert">{error||fetcher.data.error}</p>}
      {fetcher.data?.success&&<p role="status">Connected. Preparing availability for {fetcher.data.countries} countries.</p>}
    </s-section>
  </s-page>;
}
