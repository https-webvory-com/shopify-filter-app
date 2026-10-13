import { prepareCollectionRanking } from '../../../app/utils/prepareCollectionRanking.js';

// Existing ordering regressions consume a ready worker result. Preparation's
// pending, revision, retries and publication lifecycle have their own tests.
export function readyPreparation({ index, prisma, arrange }) {
  return {
    getCollectionPreparationRevision: async () => '0',
    registerCollectionWarmup: async () => {},
    getPreparedCollectionRanking: async spec => ({ status: 'ready', ...await prepareCollectionRanking(spec, {index,prisma,arrange}) }),
  };
}
