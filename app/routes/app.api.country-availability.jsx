import {authenticate} from '../shopify.server';
import {getMarketAvailabilityProgress} from '../services/marketAvailability.server.js';

export const loader=async({request})=>{
  const {session}=await authenticate.admin(request);
  try{
    return Response.json(await getMarketAvailabilityProgress(session.shop),{headers:{'Cache-Control':'no-store'}});
  }catch{
    return Response.json({error:'Unable to load preparation status. Please try again.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
};
