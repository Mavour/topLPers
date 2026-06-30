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
import { getPrices, getSolPrice } from '../api/price.js';
import { getLivePositionState } from '../core/livePositionValue.js';
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
  return numberFrom(firstDefined(pool, ['trade_volume_24h', 'volume_24h', 'volume24h', 'volumeUsd24h', 'volume.24h']), 0);
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

function withPoolPrices(pool, prices) {
  return {
    ...pool,
    token_x_price: prices.get(pool.token_x_mint) || 0,
    token_y_price: prices.get(pool.token_y_mint) || 0,
  };
}

function ownerAddress(position) {
  return firstDefined(position, ['owner', 'wallet', 'user', 'ownerAddress', 'owner_address', 'authority']);
}

export async function collectWalletsFromPools(pools) {
  const limit = pLimit(config.concurrency);
  const walletPoolMap = new Map();
  const walletOpenPositions = new Map();

  await Promise.allSettled(pools.map((pool) => limit(async () => {
    try {
      const positions = await getPoolPositions(pool.address, config.maxPositions);
      for (const pos of positions) {
        const owner = ownerAddress(pos);
        if (!owner || owner.length < 32) continue;
        if (!walletPoolMap.has(owner)) walletPoolMap.set(owner, new Set());
        walletPoolMap.get(owner).add(pool.address);
        if (!walletOpenPositions.has(owner)) walletOpenPositions.set(owner, []);
        walletOpenPositions.get(owner).push({
          ...pos,
          position_address: firstDefined(pos, ['position_address', 'position', 'pubkey', 'address']),
          pool_address: pool.address,
          pool_name: pool.name,
          current_value_usd: 0,
          fees_usd: 0,
        });
      }
      console.log(`  [pools] ${(pool.name || pool.address.slice(0, 8)).padEnd(20)} -> ${positions.length} positions`);
    } catch (error) {
      console.warn(`  [pools] failed ${pool.address.slice(0, 8)}: ${error.message}`);
    }
  })));

  return { walletPoolMap, walletOpenPositions };
}

async function withLiveOpenValue(position, poolByAddress) {
  const poolAddress = firstDefined(position, ['pool_address', 'pair_address', 'lb_pair']);
  const positionAddress = firstDefined(position, ['position_address', 'position', 'pubkey', 'address']);
  const poolInfo = poolByAddress.get(poolAddress) || position;
  if (!poolAddress || !positionAddress) return { ...position, ...poolInfo };

  try {
    const live = await getLivePositionState(positionAddress, poolAddress, poolInfo);
    return { ...poolInfo, ...position, ...live, position_address: positionAddress, pool_address: poolAddress };
  } catch (error) {
    console.warn(`  [live] failed ${positionAddress.slice(0, 8)}: ${error.message}`);
    return { ...poolInfo, ...position, position_address: positionAddress, pool_address: poolAddress };
  }
}

function uniqueByPositionAddress(positions) {
  const seen = new Set();
  const unique = [];
  for (const position of positions) {
    const key = firstDefined(position, ['position_address', 'position', 'pubkey', 'address']);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    unique.push(position);
  }
  return unique;
}

export async function computeWalletPnls(wallets, solPrice, onProgress, fallbackOpenPositions = new Map(), onWalletPnl = null, poolByAddress = new Map()) {
  const limit = pLimit(config.concurrency);
  const liveLimit = pLimit(config.livePositionConcurrency);
  const results = new Map();
  let done = 0;

  await Promise.allSettled(wallets.map((wallet) => limit(async () => {
    try {
      const [closed, open] = await Promise.all([
        getWalletClosedPositions(wallet).catch(() => []),
        getWalletOpenPositions(wallet).catch(() => []),
      ]);
      const normalizedClosed = closed.map((position) => {
        const poolInfo = poolByAddress.get(position.pool_address || position.pair_address || position.lb_pair) || {};
        return normalizeClosedPosition({ ...poolInfo, ...position }, solPrice);
      });
      const fallbackOpen = fallbackOpenPositions.get(wallet) || [];
      const liveOpen = await Promise.all(uniqueByPositionAddress([...open, ...fallbackOpen])
        .map((position) => liveLimit(() => withLiveOpenValue(position, poolByAddress))));
      const normalizedOpen = liveOpen.map((position) => normalizeOpenPosition(position, solPrice));
      const summary = aggregateWalletPnl(wallet, normalizedClosed, normalizedOpen);
      if (summary.positionCount > 0) {
        results.set(wallet, summary);
        if (onWalletPnl) onWalletPnl(wallet, summary);
      }
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

export async function crawlAll(onProgress, hooks = {}) {
  try {
    console.log('[crawler] fetching active pools...');
    const rawPools = (await getActivePools()).map(normalizePool).filter((pool) => pool.address);
    const priceMints = rawPools.flatMap((pool) => [pool.token_x_mint, pool.token_y_mint]).filter(Boolean);
    const tokenPrices = await getPrices(priceMints);
    const pools = rawPools.map((pool) => withPoolPrices(pool, tokenPrices));
    const poolByAddress = new Map(pools.map((pool) => [pool.address, pool]));
    if (!pools.length) throw new Error('Meteora returned no indexable pools after normalization/filtering');
    console.log(`[crawler] got ${pools.length} pools`);
    if (hooks.onPools) hooks.onPools(pools);

    console.log('[crawler] collecting wallets from pools...');
    const { walletPoolMap, walletOpenPositions } = await collectWalletsFromPools(pools);
    const uniqueWallets = Array.from(walletPoolMap.keys());
    console.log(`[crawler] found ${uniqueWallets.length} unique wallets`);

    const solPrice = await getSolPrice();
    console.log(`[crawler] SOL $${solPrice.toFixed(2)}`);

    const walletPnls = await computeWalletPnls(uniqueWallets, solPrice, (done, total) => {
      if (onProgress) onProgress({ phase: 'computing_pnl', done, total, walletsFound: done });
    }, walletOpenPositions, hooks.onWalletPnl, poolByAddress);

    return {
      pools,
      walletPnls,
      walletPoolMap,
      solPrice,
      totalWallets: uniqueWallets.length,
      successWallets: walletPnls.size,
    };
  } catch (error) {
    console.error('[CRAWLER FATAL]', error instanceof Error ? error.message : String(error), error?.stack || '');
    throw error;
  }
}
