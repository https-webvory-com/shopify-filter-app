import {authenticate} from '../shopify.server';
import {getSynonymActivationStatus} from '../services/synonymActivation.server.js';

export async function loader({request}) {
  const {session} = await authenticate.admin(request);
  const requestKey = new URL(request.url).searchParams.get('check')?.slice(0, 100) || null;
  try {
    return Response.json({...await getSynonymActivationStatus(session.shop), requestKey}, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    console.error('CFP Synonym status unavailable:', error.name);
    return Response.json({phase: 'unavailable', requestKey}, {headers: {'Cache-Control': 'no-store'}});
  }
}
