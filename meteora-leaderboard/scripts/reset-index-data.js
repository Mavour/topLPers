import '../src/db/schema.js';
import { getStats, resetIndexedData } from '../src/db/queries.js';

const before = getStats();
resetIndexedData();
const after = getStats();

console.log(JSON.stringify({
  reset: true,
  before: {
    wallets: before.walletCount,
    pools: before.poolCount,
    positions: before.positionCount,
    lastRun: before.lastRun?.id || null,
  },
  after: {
    wallets: after.walletCount,
    pools: after.poolCount,
    positions: after.positionCount,
    lastRun: after.lastRun?.id || null,
  },
}, null, 2));
