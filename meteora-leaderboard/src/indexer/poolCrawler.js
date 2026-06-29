import pLimit from 'p-limit';
import { config } from '../config.js';
import { firstDefined, getPool, getPoolPositions, getTopPools as fetchTopPools, numberFrom } from '../api/meteora.js';
import { getPrices } from '../api/price.js';
import { aggregateByWallet, computePositionPnl, poolAddress, poolMetric, poolName, tokenMint, tokenSymbol } from './pnlEngine.js';

function positionAddress(row) {
  return firstDefined(row, ['position', 'positionAddress', 'position_address', 'publicKey', 'pubkey', 'address']);
}

function ownerAddress(row) {
  return firstDefined(row, ['owner', 'ownerAddress', 'owner_address', 'user', 'userAddress', 'authority', 'wallet']);
}

export function normalizePool(pool) {
  const address = poolAddress(pool);
  return {
    address,
    name: poolName(pool),
    token_x_mint: tokenMint(pool, 'x'),
    token_y_mint: tokenMint(pool, 'y'),
    token_x_symbol: tokenSymbol(pool, 'x') || 'X',
    token_y_symbol: tokenSymbol(pool, 'y') || 'Y',
    bin_step: poolMetric(pool, ['binStep', 'bin_step', 'pool_config.bin_step']),
    fee_rate: poolMetric(pool, ['feeRate', 'fee_rate', 'pool_config.base_fee_pct', 'baseFeePercentage', 'base_fee_percentage']),
    tvl_usd: poolMetric(pool, ['current_tvl', 'tvlUsd', 'tvl_usd', 'tvl', 'liquidityUsd', 'liquidity']),
    volume_24h_usd: poolMetric(pool, ['volumeUsd24h', 'volume_usd_24h', 'volume24h', 'volume_24h', 'trade_volume_24h']),
    last_indexed: Date.now(),
    position_count: numberFrom(firstDefined(pool, ['position_count', 'positionCount']), 0),
    raw: pool,
  };
}

export async function crawlPool(poolAddressValue, solPrice) {
  try {
    const poolInfo = await getPool(poolAddressValue);
    const normalized = normalizePool({ ...poolInfo, address: poolAddressValue });
    const positions = await getPoolPositions(poolAddressValue, config.maxPositionsPerPool);
    const currentPrices = await getPrices([normalized.token_x_mint, normalized.token_y_mint]);
    if (solPrice) currentPrices.set('So11111111111111111111111111111111111111112', solPrice);

    const limiter = pLimit(config.concurrency);
    const ownerMap = new Map();
    let done = 0;
    const results = await Promise.all(positions.map((row) => limiter(async () => {
      const addr = positionAddress(row);
      const owner = ownerAddress(row);
      if (addr && owner) ownerMap.set(addr, owner);
      const result = await computePositionPnl(addr, normalized.raw || normalized, currentPrices);
      done += 1;
      if (done % 10 === 0 || done === positions.length) {
        console.log(`  [${poolAddressValue.slice(0, 8)}] ${done}/${positions.length} positions`);
      }
      return result;
    })));

    const walletResults = aggregateByWallet(results, ownerMap, normalized);
    return {
      poolInfo: { ...normalized, position_count: positions.length },
      walletResults,
      totalPositions: positions.length,
      errorCount: results.filter((row) => row.error).length,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), walletResults: new Map(), totalPositions: 0, errorCount: 1 };
  }
}

export async function crawlTopPools(topN = config.topPoolsLimit) {
  const pools = await fetchTopPools(topN);
  return pools
    .map(normalizePool)
    .filter((pool) => pool.address && pool.tvl_usd > 1000)
    .slice(0, topN);
}
