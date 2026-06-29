import express from 'express';
import { getWalletClosedPositions, getWalletOpenPositions, isValidAddress } from '../api/meteora.js';
import { getWalletPoolBreakdown, getWalletSummary } from '../db/queries.js';
import { normalizeClosedPosition, normalizeOpenPosition } from '../indexer/pnlEngine.js';
import { getSolPrice } from '../api/price.js';

const router = express.Router();

function iso(ts) {
  return ts ? new Date(ts).toISOString() : null;
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
    const openPositions = rawOpenPositions.map((position) => normalizeOpenPosition(position, solPrice));
    const closedPositions = rawClosedPositions.map((position) => normalizeClosedPosition(position, solPrice));
    if (!summary && openPositions.length === 0 && closedPositions.length === 0) {
      return res.status(404).json({ error: 'Wallet tidak ditemukan atau belum pernah LP di Meteora' });
    }

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
      poolBreakdown: poolBreakdown.map((row) => ({
        poolAddress: row.pool_address,
        poolName: row.pool_name,
        pnlUsd: row.pnl_usd,
        pnlSol: row.pnl_sol,
        feesEarnedUsd: row.fees_earned_usd,
        depositedUsd: row.deposited_usd,
        withdrawnUsd: row.withdrawn_usd,
        positionCount: row.position_count,
        hasOpenPosition: Boolean(row.has_open),
        openPositions: openPositions
          .filter((position) => position.poolAddress === row.pool_address)
          .map((position) => ({
            positionAddress: position.positionAddress,
            poolAddress: position.poolAddress,
            currentValueUsd: position.currentValueUsd,
            feesUsd: position.feesUsd,
            binRange: position.binRange,
            createdAt: position.createdAt,
          })),
        closedPositions: closedPositions
          .filter((position) => position.poolAddress === row.pool_address)
          .map((position) => ({
            positionAddress: position.positionAddress,
            pnlUsd: position.pnlUsd,
            feesUsd: position.feesUsd,
            depositedUsd: position.depositedUsd,
            withdrawnUsd: position.withdrawnUsd,
            closedAt: position.closedAt,
            createdAt: position.createdAt,
            durationSeconds: position.durationSeconds,
            binRange: position.binRange,
          })),
      })),
      dataSource: summary && openPositions.length > 0 ? 'mixed' : summary ? 'indexed' : 'live',
      lastUpdated: iso(summary?.last_updated),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
