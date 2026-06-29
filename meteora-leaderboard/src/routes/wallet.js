import express from 'express';
import { getPoolPositions, getWalletClosedPositions, getWalletOpenPositions, isValidAddress } from '../api/meteora.js';
import { getWalletPoolBreakdown, getWalletSummary } from '../db/queries.js';
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

router.get('/:address', async (req, res) => {
  try {
    const wallet = req.params.address;
    if (!isValidAddress(wallet)) return res.status(400).json({ error: 'Wallet address tidak valid' });

    const summary = getWalletSummary(wallet);
    const poolBreakdown = getWalletPoolBreakdown(wallet);
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

    const pools = new Map(poolBreakdown.map((row) => [row.pool_address, {
      poolAddress: row.pool_address,
      poolName: row.pool_name,
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

    for (const position of openPositions) {
      const key = position.poolAddress || 'unknown';
      if (!pools.has(key)) {
        pools.set(key, {
          poolAddress: key,
          poolName: key,
          pnlUsd: 0,
          pnlSol: 0,
          feesEarnedUsd: 0,
          depositedUsd: 0,
          withdrawnUsd: 0,
          positionCount: 0,
          hasOpenPosition: true,
          openPositions: [],
          closedPositions: [],
        });
      }
      const pool = pools.get(key);
      pool.hasOpenPosition = true;
      pool.openPositions.push({
        positionAddress: position.positionAddress,
        poolAddress: position.poolAddress,
        currentValueUsd: position.currentValueUsd,
        feesUsd: position.feesUsd,
        binRange: position.binRange,
        createdAt: flexibleIso(position.createdAt),
      });
    }

    for (const position of closedPositions) {
      const key = position.poolAddress || 'unknown';
      if (!pools.has(key)) {
        pools.set(key, {
          poolAddress: key,
          poolName: key,
          pnlUsd: position.pnlUsd,
          pnlSol: position.pnlSol,
          feesEarnedUsd: position.feesUsd,
          depositedUsd: position.depositedUsd,
          withdrawnUsd: position.withdrawnUsd,
          positionCount: 0,
          hasOpenPosition: false,
          openPositions: [],
          closedPositions: [],
        });
      }
      pools.get(key).closedPositions.push({
        positionAddress: position.positionAddress,
        poolAddress: position.poolAddress,
        pnlUsd: position.pnlUsd,
        feesUsd: position.feesUsd,
        depositedUsd: position.depositedUsd,
        withdrawnUsd: position.withdrawnUsd,
        closedAt: flexibleIso(position.closedAt),
        createdAt: flexibleIso(position.createdAt),
        durationSeconds: position.durationSeconds,
        binRange: position.binRange,
      });
    }

    const mergedPoolBreakdown = Array.from(pools.values()).map((pool) => ({
      ...pool,
      positionCount: Math.max(pool.positionCount || 0, pool.openPositions.length + pool.closedPositions.length),
      hasOpenPosition: pool.hasOpenPosition || pool.openPositions.length > 0,
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
      dataSource: summary && openPositions.length > 0 ? 'mixed' : summary ? 'indexed' : 'live',
      lastUpdated: iso(summary?.last_updated),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
