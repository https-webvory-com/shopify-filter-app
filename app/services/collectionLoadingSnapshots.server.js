import database from '../db.server.js';
import redis from './redis.server.js';
import {createCollectionLoadingSnapshots} from '../utils/collectionLoadingSnapshots.js';

let reported=false;
const store=createCollectionLoadingSnapshots({database,redis,observe:error=>{
 if(!reported){reported=true;console.warn('CFP: Durable collection loading unavailable:',error.name);}
}});
export const loadCollectionLoadingSnapshot=store.load;
export const saveCollectionLoadingSnapshot=store.save;
export const getCollectionLoadingGeneration=store.generation;
