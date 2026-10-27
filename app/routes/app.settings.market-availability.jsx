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
  const connecting=busy||fetcher.state!=='idle';
  const countries=[...new Set(connection?.countries||[])].sort();
  const countryNames=new Intl.DisplayNames(['en'],{type:'region'});
  const message=error||fetcher.data?.error;
  return <s-page heading="Country availability">
    <ui-title-bar title="Country availability">
      <button variant="breadcrumb" onClick={()=>navigate('/app/settings/general')}>General settings</button>
    </ui-title-bar>
    <style>{`
      .country-page{color:#1f2937;padding:8px 0 24px;font-size:14px;line-height:1.6}
      .country-back{display:inline-flex;align-items:center;gap:8px;color:#6d28d9;text-decoration:none;font-weight:600;margin-bottom:24px;border-radius:4px}
      .country-layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(250px,1fr);gap:24px;align-items:start}
      .country-card{background:#fff;border:1px solid #ede9fe;border-radius:16px;padding:28px;box-shadow:0 2px 8px #00000005}
      .country-card h2{font-size:19px;line-height:1.4;margin:0 0 10px;font-weight:650}
      .country-card h3{font-size:15px;margin:0 0 8px}
      .country-page p{margin:0;color:#6b7280}
      .country-status-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px}
      .country-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:14px;background:#f5f3ff;color:#7c3aed}
      .country-badge{display:inline-flex;align-items:center;gap:7px;border-radius:20px;padding:4px 11px;font-size:12px;font-weight:600;background:#f3f4f6;color:#4b5563}
      .country-badge-connected{background:#ecfdf3;color:#166534}
      .country-dot{width:6px;height:6px;background:currentColor;border-radius:50%}
      .country-callout{background:#f5f3ff;border:1px solid #ede9fe;border-radius:10px;padding:16px;margin:24px 0;color:#5b21b6}
      .country-callout p{color:#5b21b6;font-size:13px;margin-top:4px}
      .country-primary{border:0;border-radius:9px;background:#7c3aed;color:white;font:inherit;font-weight:600;padding:11px 18px;min-height:44px;cursor:pointer}
      .country-primary:hover:not(:disabled){background:#6d28d9}
      .country-primary:disabled{opacity:.65;cursor:wait}
      .country-page a:focus-visible,.country-page button:focus-visible{outline:2px solid #7c3aed;outline-offset:4px}
      .country-help{font-size:12px;margin-top:10px!important}
      .country-divider{border-top:1px solid #ede9fe;margin-top:26px;padding-top:22px}
      .country-list{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-wrap:wrap;gap:8px;max-height:300px;overflow:auto}
      .country-list li{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font-size:13px}
      .country-code{color:#6b7280;font-size:11px;margin-left:6px}
      .country-steps{list-style:none;counter-reset:steps;padding:0;margin:20px 0 0;display:grid;gap:22px}
      .country-steps li{counter-increment:steps;display:grid;grid-template-columns:26px 1fr;gap:10px}
      .country-steps li:before{content:counter(steps);display:grid;place-items:center;background:#f5f3ff;color:#6d28d9;border-radius:50%;width:26px;height:26px;font-size:12px;font-weight:700}
      .country-steps strong{display:block;font-size:13px;margin-bottom:3px}
      .country-steps p{font-size:13px}
      .country-feedback{padding:13px 16px;border-radius:9px;margin-top:18px;font-size:13px}
      .country-error{color:#991b1b;background:#fef2f2;border:1px solid #fecaca}
      .country-success{color:#166534;background:#f0fdf4;border:1px solid #bbf7d0}
      @media(max-width:760px){.country-layout{grid-template-columns:1fr}.country-card{padding:20px}.country-primary{width:100%}}
    `}</style>
    <div className="country-page">
      <a className="country-back" href="/app/settings/general" onClick={event=>{event.preventDefault();navigate('/app/settings/general');}}><span aria-hidden="true">←</span> General settings</a>
      <div className="country-layout">
        <section className="country-card" aria-labelledby="country-connection-heading">
          <div className="country-status-row">
            <span className="country-icon" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/></svg></span>
            <span className={`country-badge${connection?' country-badge-connected':''}`}><span className="country-dot"/>{connection?'Connected':'Not connected'}</span>
          </div>
          <h2 id="country-connection-heading">Show the right products in every country</h2>
          <p>Keep collection results relevant to each shopper with product availability from their selected Shopify country.</p>
          <div className="country-callout"><strong>Country stock takes priority</strong><p>Products unavailable in the shopper’s country are hidden even when “Show only in-stock products” is turned off.</p></div>
          <button className="country-primary" type="button" disabled={connecting} aria-busy={connecting} onClick={connect}>{connecting?'Connecting…':connection?'Refresh connection and countries':'Connect country availability'}</button>
          <p className="country-help">{connection?'Refresh to verify your connection and enabled Shopify countries.':'Approve read-only product listings access in Shopify. No API key needed.'}</p>
          {message&&<div className="country-feedback country-error" role="alert">{message}</div>}
          {!message&&fetcher.data?.success&&<div className="country-feedback country-success" role="status">Connected. Preparing availability for {fetcher.data.countries} countries. Collection pages will update as preparation completes.</div>}
          {connection&&<div className="country-divider">
            <h3>Connected countries <span className="country-badge">{countries.length}</span></h3>
            <p>Countries are managed in Shopify and checked periodically.</p>
            {countries.length>0?<ul className="country-list" aria-label="Connected Shopify countries">{countries.map(code=><li key={code}>{countryNames.of(code)}<span className="country-code">{code}</span></li>)}</ul>:<p className="country-help">No countries found. Refresh your connection to check again.</p>}
          </div>}
        </section>
        <aside className="country-card" aria-labelledby="country-how-heading">
          <h3 id="country-how-heading">How it works</h3>
          <ol className="country-steps">
            <li><div><strong>Connect with Shopify</strong><p>Grant read-only access so the app can check product availability by country.</p></div></li>
            <li><div><strong>Prepare country collections</strong><p>Availability and collection pages are prepared in the background. Initial setup can take time.</p></div></li>
            <li><div><strong>Keep results up to date</strong><p>Stock changes trigger background refreshes. Completed updates appear on reload or the shopper’s next action.</p></div></li>
          </ol>
          <div className="country-divider"><h3>Connection is separate from readiness</h3><p>A connected country may still be preparing its collection pages. Stock changes are not immediate.</p></div>
        </aside>
      </div>
    </div>
  </s-page>;
}
