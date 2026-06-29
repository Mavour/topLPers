import pLimit from 'p-limit';
import { config } from '../config.js';
import {
  firstDefined,
  getActivePools,
  getPoolPositions,
  getWalletClosedPositions,
  getWalletOpenPositions,
  numberFrom,
  tokenMint,
} from '../api/meteora.js';
import { getSolPrice } from '../api/price.js';
import { aggregateWalletPnl, normalizeClosedPosition, normalizeOpenPosition } from './pnlEngine.js';

function poolAddress(pool) {
  return firstDefined(pool, ['address', 'pubkey', 'pair_address', 'pool_address']);
}

function poolName(pool) {
  const name = firstDefined(pool, ['name', 'pool_name', 'symbol', 'pair_name']);
  if (name) return String(name);
  const x = firstDefined(pool, ['mint_x_symbol', 'token_x_symbol', 'tokenX.symbol', 'token_x.symbol']) || '?';
  const y = firstDefined(pool, ['mint_y_symbol', 'token_y_symbol', 'tokenY.symbol', 'token_y.symbol']) || '?';
  return `${x}/${y}`;
}

function poolVolume24h(pool) {
  return numberFrom(firstDefined(pool, ['trade_volume_24h', 'volume_24h', 'volume24h', 'volumeUsd24h']), 0);
}

export function normalizePool(pool) {
  const address = poolAddress(pool);
  return {
    ...pool,
    address,
    name: poolName(pool),
    token_x_mint: tokenMint(pool, 'x') || firstDefined(pool, ['mint_x']),
    token_y_mint: tokenMint(pool, 'y') || firstDefined(pool, ['mint_y']),
    token_x_symbol: firstDefined(pool, ['mint_x_symbol', 'token_x_symbol', 'tokenX.symbol', 'token_x.symbol']) || '',
    token_y_symbol: firstDefined(pool, ['mint_y_symbol', 'token_y_symbol', 'tokenY.symbol', 'token_y.symbol']) || '',
    bin_step: numberFrom(firstDefined(pool, ['bin_step', 'binStep', 'pool_config.bin_step']), 0),
    fee_rate: numberFrom(firstDefined(pool, ['base_fee_percentage', 'fee_rate', 'feeRate', 'pool_config.base_fee_pct']), 0),
    tvl_usd: numberFrom(firstDefined(pool, ['current_tvl', 'tvl', 'tvlUsd', 'liquidity']), 0),
    volume_24h_usd: poolVolume24h(pool),
  };
}

function ownerAddress(position) {
  return firstDefined(position, ['owner', 'wallet', 'user', 'ownerAddress', 'owner_address', 'authority']);
}

export async function collectWalletsFromPools(pools) {
  const limit = pLimit(8);
  const walletPoolMap = new Map();

  await Promise.allSettled(pools.map((pool) => limit(async () => {
    try {
      const positions = await getPoolPositions(pool.address, config.maxPositions);
      for (const pos of positions) {
        const owner = ownerAddress(pos);
        if (!owner || owner.length < 32) continue;
        if (!walletPoolMap.has(owner)) walletPoolMap.set(owner, new Set());
        walletPoolMap.get(owner).add(pool.address);
      }
      console.log(`  [pools] ${(pool.name || pool.address.slice(0, 8)).padEnd(20)} -> ${positions.length} positions`);
    } catch (error) {
      console.warn(`  [pools] failed ${pool.address.slice(0, 8)}: ${error.message}`);
    }
  })));

  return walletPoolMap;
}

export async function computeWalletPnls(wallets, solPrice, onProgress) {
  const limit = pLimit(config.concurrency);
  const results = new Map();
  let done = 0;

  await Promise.allSettled(wallets.map((wallet) => limit(async () => {
    try {
      const [closed, open] = await Promise.all([
        getWalletClosedPositions(wallet).catch(() => []),
        getWalletOpenPositions(wallet).catch(() => []),
      ]);
      const normalizedClosed = closed.map((position) => normalizeClosedPosition(position, solPrice));
      const normalizedOpen = open.map((position) => normalizeOpenPosition(position, solPrice));
      const summary = aggregateWalletPnl(wallet, normalizedClosed, normalizedOpen);
      if (summary.positionCount > 0) results.set(wallet, summary);
    } catch (error) {
      console.warn(`  [wallet] failed ${wallet.slice(0, 8)}: ${error.message}`);
    }
    done += 1;
    if (onProgress) onProgress(done, wallets.length);
    if (done % 50 === 0) process.stdout.write(`\r[crawler] ${done}/${wallets.length} wallets`);
  })));
  process.stdout.write('\n');
  return results;
}

export async function crawlAll(onProgress) {
  console.log('[crawler] fetching active pools...');
  const pools = (await getActivePools()).map(normalizePool).filter((pool) => pool.address);
  console.log(`[crawler] got ${pools.length} pools`);

  console.log('[crawler] collecting wallets from pools...');
  const walletPoolMap = await collectWalletsFromPools(pools);
  const uniqueWallets = Array.from(walletPoolMap.keys());
  console.log(`[crawler] found ${uniqueWallets.length} unique wallets`);

  const solPrice = await getSolPrice();
  console.log(`[crawler] SOL $${solPrice.toFixed(2)}`);

  const walletPnls = await computeWalletPnls(uniqueWallets, solPrice, (done, total) => {
    if (onProgress) onProgress({ phase: 'computing_pnl', done, total, walletsFound: done });
  });

  return {
    pools,
    walletPnls,
    walletPoolMap,
    solPrice,
    totalWallets: uniqueWallets.length,
    successWallets: walletPnls.size,
  };
}
