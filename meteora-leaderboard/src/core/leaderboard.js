import pLimit from 'p-limit';
import { config } from '../config.js';
import { get as cacheGet, set as cacheSet } from '../cache/memCache.js';
import { getPool, getPoolPositions, getWalletPoolPositions, firstDefined, numberFrom } from '../api/meteoraApi.js';
import { getTokenPrices, getSolPrice } from '../api/priceApi.js';
import { computePositionPnl } from './pnlEngine.js';

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

function tokenMint(pool, side) {
  const upper = side.toUpperCase();
  const lower = side.toLowerCase();
  return nestedFirst(pool, [
    `token_${lower}_mint`,
    `token${upper}Mint`,
    `mint_${lower}`,
    `mint${upper}`,
    `token${upper}.mint`,
    `token_${lower}.mint`,
    `token${upper}.address`,
    `token_${lower}.address`,
    `token${upper}.address`,
  ]);
}

function tokenSymbol(pool, side) {
  const upper = side.toUpperCase();
  const lower = side.toLowerCase();
  return nestedFirst(pool, [
    `token_${lower}_symbol`,
    `token${upper}Symbol`,
    `token${upper}.symbol`,
    `token_${lower}.symbol`,
  ]);
}

function poolName(pool) {
  const explicit = nestedFirst(pool, ['name', 'pool_name', 'symbol']);
  if (explicit) {
    return String(explicit);
  }
  const x = tokenSymbol(pool, 'x') || 'Token X';
  const y = tokenSymbol(pool, 'y') || 'Token Y';
  return `${x}/${y}`;
}

function metric(pool, keys) {
  return numberFrom(nestedFirst(pool, keys), 0);
}

function poolSummary(address, pool) {
  return {
    address,
    name: poolName(pool),
    tokenX: {
      mint: tokenMint(pool, 'x'),
      symbol: tokenSymbol(pool, 'x') || 'X',
    },
    tokenY: {
      mint: tokenMint(pool, 'y'),
      symbol: tokenSymbol(pool, 'y') || 'Y',
    },
    tvlUsd: metric(pool, ['tvlUsd', 'tvl_usd', 'tvl', 'liquidityUsd', 'liquidity_usd', 'liquidity']),
    volumeUsd24h: metric(pool, ['volumeUsd24h', 'volume_usd_24h', 'volume24h', 'volume_24h', 'volume.24h', 'trade_volume_24h']),
    feeRate: metric(pool, ['feeRate', 'fee_rate', 'pool_config.base_fee_pct', 'baseFeePercentage', 'base_fee_percentage', 'fees.base_fee_percentage']),
    binStep: metric(pool, ['binStep', 'bin_step', 'pool_config.bin_step']),
    activeBin: metric(pool, ['activeBin', 'active_bin', 'activeId', 'active_id']),
  };
}

function positionAddress(row) {
  return nestedFirst(row, ['position', 'positionAddress', 'position_address', 'publicKey', 'pubkey', 'address']);
}

function ownerAddress(row) {
  return nestedFirst(row, ['owner', 'ownerAddress', 'owner_address', 'user', 'userAddress', 'authority', 'wallet']);
}

function aggregateByWallet(positionPnls) {
  const wallets = new Map();

  for (const item of positionPnls) {
    if (!item.owner) {
      continue;
    }

    const existing = wallets.get(item.owner) || {
      wallet: item.owner,
      pnlUsd: 0,
      pnlSol: 0,
      pnlWithUnclaimedFeesUsd: 0,
      pnlWithUnclaimedFeesSol: 0,
      feesEarnedUsd: 0,
      unclaimedFeesUsd: 0,
      positionCount: 0,
      totalDepositedUsd: 0,
      totalWithdrawnUsd: 0,
      currentPositionUsd: 0,
      currentXAmount: 0,
      currentYAmount: 0,
      isActive: false,
      errors: 0,
      valuationSource: null,
    };

    existing.pnlUsd += item.pnlUsd || 0;
    existing.pnlSol += item.pnlSol || 0;
    existing.pnlWithUnclaimedFeesUsd += item.pnlWithUnclaimedFeesUsd || item.pnlUsd || 0;
    existing.pnlWithUnclaimedFeesSol += item.pnlWithUnclaimedFeesSol || item.pnlSol || 0;
    existing.feesEarnedUsd += item.feesEarnedUsd || 0;
    existing.unclaimedFeesUsd += item.unclaimedFeesUsd || 0;
    existing.totalDepositedUsd += item.totalDepositedUsd || 0;
    existing.totalWithdrawnUsd += item.totalWithdrawnUsd || 0;
    existing.currentPositionUsd += item.currentPositionUsd || 0;
    existing.currentXAmount += item.currentXAmount || 0;
    existing.currentYAmount += item.currentYAmount || 0;
    existing.positionCount += 1;
    existing.isActive = existing.isActive || Boolean(item.isActive);
    existing.errors += item.error ? 1 : 0;
    existing.valuationSource = existing.valuationSource || item.valuationSource || null;
    wallets.set(item.owner, existing);
  }

  return [...wallets.values()];
}

function sortRankings(rows, mode) {
  const direction = mode === 'losers' ? 1 : -1;
  return rows
    .sort((left, right) => (left.pnlUsd - right.pnlUsd) * direction)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function normalizeMode(mode) {
  return String(mode || 'winners').toLowerCase() === 'losers' ? 'losers' : 'winners';
}

function progress(done, total, onProgress) {
  if (onProgress) {
    onProgress(done, total);
    return;
  }
  process.stderr.write(`\rComputing PnL... ${done}/${total}`);
  if (done >= total) {
    process.stderr.write('\n');
  }
}

export async function buildPoolLeaderboard(poolAddress, opts = {}) {
  const startedAt = Date.now();
  const mode = normalizeMode(opts.mode);
  const limit = Math.max(1, Number.parseInt(opts.limit, 10) || config.maxPositions);
  const concurrency = Math.max(1, Number.parseInt(opts.concurrency, 10) || config.concurrency);
  const cacheKey = `lb:${poolAddress}:${mode}:${limit}`;
  const cached = cacheGet(cacheKey);

  if (cached && !opts.noCache) {
    return cached;
  }

  const poolInfo = await getPool(poolAddress);
  const positions = (await getPoolPositions(poolAddress, limit)).slice(0, limit);
  const summary = poolSummary(poolAddress, poolInfo);
  const mints = [summary.tokenX.mint, summary.tokenY.mint].filter(Boolean);
  const currentPrices = await getTokenPrices(mints);
  const solPrice = await getSolPrice();
  const limiter = pLimit(concurrency);
  let done = 0;

  const settled = await Promise.allSettled(positions.map((row) => limiter(async () => {
    const result = await computePositionPnl(positionAddress(row), ownerAddress(row), poolInfo, currentPrices);
    done += 1;
    progress(done, positions.length, opts.onProgress);
    return result;
  })));

  const positionPnls = settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    return {
      positionAddress: positionAddress(positions[index]),
      owner: ownerAddress(positions[index]),
      pnlUsd: 0,
      pnlSol: 0,
      pnlWithUnclaimedFeesUsd: 0,
      pnlWithUnclaimedFeesSol: 0,
      totalDepositedUsd: 0,
      totalWithdrawnUsd: 0,
      currentPositionUsd: 0,
      currentXAmount: 0,
      currentYAmount: 0,
      unclaimedFeesUsd: 0,
      feesEarnedUsd: 0,
      depositCount: 0,
      withdrawCount: 0,
      isActive: false,
      computedAt: Date.now(),
      error: result.reason?.message || String(result.reason),
    };
  });

  const rankings = sortRankings(aggregateByWallet(positionPnls), mode);
  const output = {
    pool: summary,
    rankings,
    meta: {
      mode,
      totalWallets: rankings.length,
      totalPositions: positions.length,
      computedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      solPrice,
    },
  };

  cacheSet(cacheKey, output, 3 * 60_000);
  return output;
}

export async function getMultiPoolLeaderboard(poolAddresses, opts = {}) {
  const mode = normalizeMode(opts.mode);
  const startedAt = Date.now();
  const results = await Promise.allSettled(
    (poolAddresses || []).map((poolAddress) => buildPoolLeaderboard(poolAddress, opts)),
  );
  const rows = new Map();

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      console.error(`[leaderboard] pool failed: ${result.reason?.message || result.reason}`);
      continue;
    }

    for (const row of result.value.rankings) {
      const existing = rows.get(row.wallet) || {
        wallet: row.wallet,
        pnlUsd: 0,
        pnlSol: 0,
        pnlWithUnclaimedFeesUsd: 0,
        pnlWithUnclaimedFeesSol: 0,
        feesEarnedUsd: 0,
        unclaimedFeesUsd: 0,
        positionCount: 0,
        totalDepositedUsd: 0,
        totalWithdrawnUsd: 0,
        currentPositionUsd: 0,
        currentXAmount: 0,
        currentYAmount: 0,
        isActive: false,
        errors: 0,
        valuationSource: null,
      };
      existing.pnlUsd += row.pnlUsd || 0;
      existing.pnlSol += row.pnlSol || 0;
      existing.pnlWithUnclaimedFeesUsd += row.pnlWithUnclaimedFeesUsd || row.pnlUsd || 0;
      existing.pnlWithUnclaimedFeesSol += row.pnlWithUnclaimedFeesSol || row.pnlSol || 0;
      existing.feesEarnedUsd += row.feesEarnedUsd || 0;
      existing.unclaimedFeesUsd += row.unclaimedFeesUsd || 0;
      existing.positionCount += row.positionCount || 0;
      existing.totalDepositedUsd += row.totalDepositedUsd || 0;
      existing.totalWithdrawnUsd += row.totalWithdrawnUsd || 0;
      existing.currentPositionUsd += row.currentPositionUsd || 0;
      existing.currentXAmount += row.currentXAmount || 0;
      existing.currentYAmount += row.currentYAmount || 0;
      existing.isActive = existing.isActive || row.isActive;
      existing.errors += row.errors || 0;
      existing.valuationSource = existing.valuationSource || row.valuationSource || null;
      rows.set(row.wallet, existing);
    }
  }

  const rankings = sortRankings([...rows.values()], mode);
  const solPrice = await getSolPrice();

  return {
    pool: {
      address: null,
      name: 'Multiple pools',
      poolCount: poolAddresses.length,
    },
    rankings,
    meta: {
      mode,
      totalWallets: rankings.length,
      poolCount: poolAddresses.length,
      computedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      solPrice,
    },
  };
}

export async function buildWalletPoolPnl(poolAddress, walletAddress, opts = {}) {
  const startedAt = Date.now();
  const limit = Math.max(1, Number.parseInt(opts.limit, 10) || config.maxPositions);
  const concurrency = Math.max(1, Number.parseInt(opts.concurrency, 10) || config.concurrency);
  const poolInfo = await getPool(poolAddress);
  const positions = await getWalletPoolPositions(poolAddress, walletAddress, limit);
  const summary = poolSummary(poolAddress, poolInfo);
  const mints = [summary.tokenX.mint, summary.tokenY.mint].filter(Boolean);
  const currentPrices = await getTokenPrices(mints);
  const solPrice = await getSolPrice();
  const limiter = pLimit(concurrency);

  const settled = await Promise.allSettled(positions.map((row) => limiter(() => (
    computePositionPnl(positionAddress(row), ownerAddress(row), poolInfo, currentPrices)
  ))));
  const positionPnls = settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      positionAddress: positionAddress(positions[index]),
      owner: ownerAddress(positions[index]),
      pnlUsd: 0,
      pnlSol: 0,
      pnlWithUnclaimedFeesUsd: 0,
      pnlWithUnclaimedFeesSol: 0,
      totalDepositedUsd: 0,
      totalWithdrawnUsd: 0,
      currentPositionUsd: 0,
      currentXAmount: 0,
      currentYAmount: 0,
      unclaimedFeesUsd: 0,
      feesEarnedUsd: 0,
      depositCount: 0,
      withdrawCount: 0,
      isActive: false,
      computedAt: Date.now(),
      error: result.reason?.message || String(result.reason),
    };
  });
  const rankings = sortRankings(aggregateByWallet(positionPnls), 'winners');

  return {
    pool: summary,
    rankings,
    meta: {
      mode: 'wallet',
      wallet: walletAddress,
      totalWallets: rankings.length,
      totalPositions: positions.length,
      computedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      solPrice,
    },
  };
}
