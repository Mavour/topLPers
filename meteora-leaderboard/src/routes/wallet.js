import express from 'express';
import { getWalletOpenPositions, isValidAddress } from '../api/meteora.js';
import { getWalletPoolBreakdown, getWalletSummary } from '../db/queries.js';

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
    const livePositions = await getWalletOpenPositions(wallet);
    if (!summary && livePositions.length === 0) {
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
        positionCount: livePositions.length,
        poolCount: 0,
      },
      poolBreakdown: poolBreakdown.map((row) => ({
        poolAddress: row.pool_address,
        poolName: row.pool_name,
        pnlUsd: row.pnl_usd,
        pnlSol: row.pnl_sol,
        feesEarnedUsd: row.fees_earned_usd,
        positionCount: row.position_count,
      })),
      dataSource: summary && livePositions.length > 0 ? 'mixed' : summary ? 'indexed' : 'live',
      lastUpdated: iso(summary?.last_updated),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
