import express from 'express';
import { getSolPrice } from '../api/price.js';
import { getStats } from '../db/queries.js';
import { getIndexState } from '../indexer/indexRunner.js';

const router = express.Router();

function iso(ts) {
  return ts ? new Date(ts).toISOString() : null;
}

router.get('/', async (req, res) => {
  try {
    const state = getIndexState();
    const stats = getStats();
    const solPrice = await Promise.race([
      getSolPrice(),
      new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    res.json({
      indexer: {
        isRunning: state.isRunning,
        phase: state.progress.phase,
        progress: state.progress,
        lastFinished: iso(state.lastFinished),
        lastError: state.lastError,
      },
      database: {
        walletCount: stats.walletCount,
        poolCount: stats.poolCount,
        positionCount: stats.positionCount,
      },
      lastRun: stats.lastRun ? {
        startedAt: iso(stats.lastRun.started_at),
        finishedAt: iso(stats.lastRun.finished_at),
        poolsIndexed: stats.lastRun.pools_indexed,
        walletsFound: stats.lastRun.wallets_found,
        status: stats.lastRun.status,
      } : null,
      solPrice,
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
