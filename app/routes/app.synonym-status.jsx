import {authenticate} from '../shopify.server';
import {getSynonymActivationStatus} from '../services/synonymActivation.server.js';

export async function loader({request}) {
  const {session} = await authenticate.admin(request);
  try {
    return Response.json(await getSynonymActivationStatus(session.shop), {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    console.error('CFP Synonym status unavailable:', error.name);
    return Response.json({phase: 'unavailable', observedAt: Date.now()}, {headers: {'Cache-Control': 'no-store'}});
  }
}
