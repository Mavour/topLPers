import { getAllPoolsPage, searchPools, firstDefined, numberFrom } from '../api/meteoraApi.js';
import { get as cacheGet, set as cacheSet } from '../cache/memCache.js';

function nestedFirst(row, keys) {
  for (const key of keys) {
    if (key.includes('.')) {
      const value = key.split('.').reduce((acc, part) => acc?.[part], row);
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    } else {
      const value = firstDefined(row, [key]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function poolAddress(pool) {
  return nestedFirst(pool, ['address', 'pubkey', 'pair_address', 'pool_address']);
}

function poolName(pool) {
  const name = nestedFirst(pool, ['name', 'symbol', 'pair_name']);
  if (name) {
    return String(name);
  }
  const x = nestedFirst(pool, ['token_x_symbol', 'tokenX.symbol', 'token_x.symbol']) || 'X';
  const y = nestedFirst(pool, ['token_y_symbol', 'tokenY.symbol', 'token_y.symbol']) || 'Y';
  return `${x}/${y}`;
}

function metric(pool, keys) {
  return numberFrom(nestedFirst(pool, keys), 0);
}

function summarizePool(pool) {
  return {
    address: poolAddress(pool),
    name: poolName(pool),
    tvlUsd: metric(pool, ['tvlUsd', 'tvl_usd', 'tvl', 'liquidityUsd', 'liquidity_usd', 'liquidity']),
    volumeUsd24h: metric(pool, ['volumeUsd24h', 'volume_usd_24h', 'volume24h', 'volume_24h', 'volume.24h', 'trade_volume_24h']),
    feeRate: metric(pool, ['feeRate', 'fee_rate', 'pool_config.base_fee_pct', 'baseFeePercentage', 'base_fee_percentage']),
    binStep: metric(pool, ['binStep', 'bin_step', 'pool_config.bin_step']),
  };
}

export async function getTopPools(limit = 20) {
  const safeLimit = Math.max(1, Number.parseInt(limit, 10) || 20);
  const cacheKey = `top-pools:${safeLimit}`;
  const cached = cacheGet(cacheKey);

  if (cached) {
    return cached;
  }

  const pages = await Promise.all([0, 1, 2].map((page) => getAllPoolsPage(page, 50)));
  const pools = pages
    .flat()
    .map(summarizePool)
    .filter((pool) => pool.address)
    .sort((left, right) => (right.volumeUsd24h || right.tvlUsd) - (left.volumeUsd24h || left.tvlUsd))
    .slice(0, safeLimit);

  cacheSet(cacheKey, pools, 5 * 60_000);
  return pools;
}

export async function searchPool(query) {
  const matches = await searchPools(query, 10);
  return matches.map(summarizePool).filter((pool) => pool.address);
}
