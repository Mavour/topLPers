import express from 'express';
import { getLeaderboard, getStats } from '../db/queries.js';

const router = express.Router();

function iso(ts) {
  return ts ? new Date(ts).toISOString() : null;
}

function rankRows(rows, offset) {
  return rows.map((row, index) => ({
    rank: offset + index + 1,
    wallet: row.wallet,
    pnlUsd: row.pnl_usd,
    pnlSol: row.pnl_sol,
    feesEarnedUsd: row.fees_earned_usd,
    depositedUsd: row.deposited_usd,
    withdrawnUsd: row.withdrawn_usd,
    positionCount: row.position_count,
    poolCount: row.pool_count || 1,
    lastUpdated: iso(row.last_updated),
  }));
}

router.get('/', (req, res) => {
  try {
    const mode = String(req.query.mode || 'winners').toLowerCase();
    if (!['winners', 'losers'].includes(mode)) return res.status(400).json({ error: 'mode harus winners atau losers' });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const pool = req.query.pool ? String(req.query.pool) : null;
    const { rows, total } = getLeaderboard({ mode, limit, offset, pool });
    const stats = getStats();
    res.json({
      mode,
      pool,
      total,
      limit,
      offset,
      rankings: rankRows(rows, offset),
      meta: {
        lastIndexed: iso(stats.lastRun?.finished_at),
        indexedPools: stats.poolCount,
        ...(total === 0 ? { message: 'Index belum dijalankan' } : {}),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
