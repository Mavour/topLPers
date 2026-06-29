import express from 'express';
import { getPoolPositions, getWalletClosedPositions, getWalletOpenPositions, isValidAddress } from '../api/meteora.js';
import { getPoolByAddress, getWalletPoolBreakdown, getWalletPositions, getWalletSummary } from '../db/queries.js';
import { normalizeClosedPosition, normalizeOpenPosition } from '../indexer/pnlEngine.js';
import { getSolPrice } from '../api/price.js';

const router = express.Router();

function iso(ts) {
  return ts ? new Date(ts).toISOString() : null;
}

function flexibleIso(value) {
  if (!value) return null;
  const numeric = Number(value);
  const ms = Number.isFinite(numeric)
    ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function firstDefined(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') return row[key];
  }
  return null;
}

function cleanUsd(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.abs(parsed) > 100_000_000 ? 0 : parsed;
}

function positionStatus(position) {
  return position.isActive ? 'open' : 'closed';
}

function rangeWidthPct(position, pool) {
  const lower = Number(position.lowerBinId);
  const upper = Number(position.upperBinId);
  const binStep = Number(pool?.binStep);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || !Number.isFinite(binStep) || binStep <= 0) return null;
  const width = Math.abs(upper - lower) + 1;
  return (Math.pow(1 + binStep / 10_000, width) - 1) * 100;
}

function pctLabel(value) {
  if (!Number.isFinite(value)) return null;
  const digits = Math.abs(value) >= 10 ? 1 : 2;
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function positionSetup(position, pool = null) {
  const lines = [];
  if (position.binRange) lines.push(`BIN RANGE ${position.binRange}`);
  const rangePct = rangeWidthPct(position, pool);
  if (rangePct !== null) lines.push(`RANGE ${pctLabel(rangePct)} FROM ENTRY (${pool.binStep} bps/bin)`);
  return lines;
}

function parseBinRange(value) {
  if (!value) return {};
  const match = String(value).match(/-?\d+/g);
  if (!match || match.length < 2) return {};
  return {
    lowerBinId: Number.parseInt(match[0], 10),
    upperBinId: Number.parseInt(match[1], 10),
  };
}

function mergedSetup(position, pool) {
  const existing = Array.isArray(position.setup) ? position.setup : [];
  const lines = [...existing];
  for (const line of positionSetup(position, pool)) {
    const key = line.split(' ')[0];
    if (!lines.some((item) => String(item).startsWith(key))) lines.push(line);
  }
  return lines;
}

function parseSetup(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function indexedPosition(row) {
  const binIds = parseBinRange(row.bin_range);
  return {
    positionAddress: row.position_address,
    poolAddress: row.pool_address,
    poolName: row.pool_name,
    status: row.status,
    pnlUsd: cleanUsd(row.pnl_usd),
    pnlSol: row.pnl_sol,
    feesUsd: cleanUsd(row.fees_usd),
    currentValueUsd: cleanUsd(row.current_value_usd),
    depositedUsd: cleanUsd(row.deposited_usd),
    withdrawnUsd: cleanUsd(row.withdrawn_usd),
    createdAt: flexibleIso(row.created_at),
    closedAt: flexibleIso(row.closed_at),
    durationSeconds: row.duration_seconds,
    binRange: row.bin_range,
    lowerBinId: binIds.lowerBinId,
    upperBinId: binIds.upperBinId,
    setup: parseSetup(row.setup_json),
  };
}

function aggregatePositionFallback(pool) {
  if ((pool.openPositions.length + pool.closedPositions.length) > 0) return [];
  if ((pool.positionCount || 0) <= 0) return [];
  return [{
    positionAddress: null,
    poolAddress: pool.poolAddress,
    poolName: pool.poolName,
    status: pool.hasOpenPosition ? 'open' : 'closed',
    aggregateOnly: true,
    pnlUsd: cleanUsd(pool.pnlUsd),
    pnlSol: cleanUsd(pool.pnlSol),
    feesUsd: cleanUsd(pool.feesEarnedUsd),
    currentValueUsd: 0,
    depositedUsd: cleanUsd(pool.depositedUsd),
    withdrawnUsd: cleanUsd(pool.withdrawnUsd),
    createdAt: flexibleIso(pool.createdAt),
    closedAt: null,
    durationSeconds: null,
    binRange: null,
    setup: [
      'AGGREGATE POOL DATA ONLY',
      'INDIVIDUAL POSITION ADDRESS / BIN RANGE NOT INDEXED YET.',
      'RUN A FRESH INDEX WITH A POSITION DETAIL SOURCE TO FILL EXACT RANGES.',
    ],
  }];
}

router.get('/:address', async (req, res) => {
  try {
    const wallet = req.params.address;
    if (!isValidAddress(wallet)) return res.status(400).json({ error: 'Wallet address tidak valid' });

    const summary = getWalletSummary(wallet);
    const poolBreakdown = getWalletPoolBreakdown(wallet);
    const indexedPositions = getWalletPositions(wallet).map(indexedPosition);
    const solPrice = await getSolPrice();
    const [rawOpenPositions, rawClosedPositions] = await Promise.all([
      getWalletOpenPositions(wallet).catch(() => []),
      getWalletClosedPositions(wallet).catch(() => []),
    ]);
    const rpcOpenPositions = rawOpenPositions.length > 0 ? [] : (await Promise.all(poolBreakdown
      .filter((row) => row.has_open)
      .map(async (row) => {
        const positions = await getPoolPositions(row.pool_address).catch(() => []);
        return positions
          .filter((position) => firstDefined(position, ['owner', 'wallet', 'authority']) === wallet)
          .map((position) => ({
            ...position,
            position_address: firstDefined(position, ['position_address', 'position', 'pubkey', 'address']),
            pool_address: row.pool_address,
            pool_name: row.pool_name,
            current_value_usd: 0,
            fees_usd: 0,
          }));
      }))).flat();
    const openPositions = [...rawOpenPositions, ...rpcOpenPositions].map((position) => normalizeOpenPosition(position, solPrice));
    const closedPositions = rawClosedPositions.map((position) => normalizeClosedPosition(position, solPrice));
    if (!summary && openPositions.length === 0 && closedPositions.length === 0) {
      return res.status(404).json({ error: 'Wallet tidak ditemukan atau belum pernah LP di Meteora' });
    }

    const poolMetaCache = new Map();
    function poolMeta(poolAddress) {
      if (!poolAddress) return null;
      if (!poolMetaCache.has(poolAddress)) poolMetaCache.set(poolAddress, getPoolByAddress(poolAddress));
      return poolMetaCache.get(poolAddress);
    }

    const pools = new Map(poolBreakdown.map((row) => [row.pool_address, {
      poolAddress: row.pool_address,
      poolName: row.pool_name,
      binStep: Number(poolMeta(row.pool_address)?.bin_step || 0),
      pnlUsd: row.pnl_usd,
      pnlSol: row.pnl_sol,
      feesEarnedUsd: row.fees_earned_usd,
      depositedUsd: row.deposited_usd,
      withdrawnUsd: row.withdrawn_usd,
      positionCount: row.position_count,
      hasOpenPosition: Boolean(row.has_open),
      openPositions: [],
      closedPositions: [],
    }]));

    function ensurePool(poolAddress, poolName = null) {
      const key = poolAddress || 'unknown';
      if (!pools.has(key)) {
        const meta = poolMeta(key);
        pools.set(key, {
          poolAddress: key,
          poolName: poolName || meta?.name || key,
          binStep: Number(meta?.bin_step || 0),
          pnlUsd: 0,
          pnlSol: 0,
          feesEarnedUsd: 0,
          depositedUsd: 0,
          withdrawnUsd: 0,
          positionCount: 0,
          hasOpenPosition: false,
          openPositions: [],
          closedPositions: [],
        });
      }
      return pools.get(key);
    }

    function hasPosition(pool, positionAddress) {
      return [...pool.openPositions, ...pool.closedPositions]
        .some((position) => position.positionAddress === positionAddress);
    }

    for (const position of indexedPositions) {
      const pool = ensurePool(position.poolAddress, position.poolName);
      if (hasPosition(pool, position.positionAddress)) continue;
      const decorated = { ...position, setup: mergedSetup(position, pool) };
      if (position.status === 'open') {
        pool.hasOpenPosition = true;
        pool.openPositions.push(decorated);
      } else {
        pool.closedPositions.push(decorated);
      }
    }

    for (const position of openPositions) {
      const pool = ensurePool(position.poolAddress);
      if (hasPosition(pool, position.positionAddress)) continue;
      pool.hasOpenPosition = true;
      pool.openPositions.push({
        positionAddress: position.positionAddress,
        poolAddress: position.poolAddress,
        poolName: pool.poolName,
        status: positionStatus(position),
        pnlUsd: cleanUsd(position.pnlUsd),
        pnlSol: position.pnlSol,
        currentValueUsd: position.currentValueUsd,
        feesUsd: position.feesUsd,
        binRange: position.binRange,
        lowerBinId: position.lowerBinId,
        upperBinId: position.upperBinId,
        createdAt: flexibleIso(position.createdAt),
        closedAt: null,
        durationSeconds: null,
        setup: positionSetup(position, pool),
      });
    }

    for (const position of closedPositions) {
      const pool = ensurePool(position.poolAddress);
      if (hasPosition(pool, position.positionAddress)) continue;
      pool.closedPositions.push({
        positionAddress: position.positionAddress,
        poolAddress: position.poolAddress,
        poolName: pool.poolName,
        status: positionStatus(position),
        pnlUsd: position.pnlUsd,
        pnlSol: position.pnlSol,
        feesUsd: position.feesUsd,
        currentValueUsd: 0,
        depositedUsd: position.depositedUsd,
        withdrawnUsd: position.withdrawnUsd,
        closedAt: flexibleIso(position.closedAt),
        createdAt: flexibleIso(position.createdAt),
        durationSeconds: position.durationSeconds,
        binRange: position.binRange,
        lowerBinId: position.lowerBinId,
        upperBinId: position.upperBinId,
        setup: positionSetup(position, pool),
      });
    }

    const mergedPoolBreakdown = Array.from(pools.values()).map((pool) => ({
      ...pool,
      pnlUsd: cleanUsd(pool.pnlUsd),
      pnlSol: cleanUsd(pool.pnlSol),
      feesEarnedUsd: cleanUsd(pool.feesEarnedUsd),
      depositedUsd: cleanUsd(pool.depositedUsd),
      withdrawnUsd: cleanUsd(pool.withdrawnUsd),
      positionCount: Math.max(pool.positionCount || 0, pool.openPositions.length + pool.closedPositions.length),
      hasOpenPosition: pool.hasOpenPosition || pool.openPositions.length > 0,
      positions: [...pool.openPositions, ...pool.closedPositions, ...aggregatePositionFallback(pool)].sort((left, right) => {
        if (left.status !== right.status) return left.status === 'open' ? -1 : 1;
        return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
      }),
    })).sort((left, right) => (right.pnlUsd || 0) - (left.pnlUsd || 0));

    res.json({
      wallet,
      summary: summary ? {
        pnlUsd: summary.pnl_usd,
        pnlSol: summary.pnl_sol,
        feesEarnedUsd: summary.fees_earned_usd,
        depositedUsd: summary.deposited_usd,
        withdrawnUsd: summary.withdrawn_usd,
        positionCount: summary.position_count,
        poolCount: summary.pool_count,
      } : {
        pnlUsd: 0,
        pnlSol: 0,
        feesEarnedUsd: 0,
        depositedUsd: 0,
        withdrawnUsd: 0,
        positionCount: openPositions.length + closedPositions.length,
        poolCount: new Set([...openPositions, ...closedPositions].map((position) => position.poolAddress)).size,
      },
      poolBreakdown: mergedPoolBreakdown,
      pools: mergedPoolBreakdown,
      dataSource: summary && openPositions.length > 0 ? 'mixed' : summary ? 'indexed' : 'live',
      lastUpdated: iso(summary?.last_updated),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
