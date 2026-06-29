import express from 'express';
import { getAllPools } from '../db/queries.js';

const router = express.Router();

function iso(ts) {
  return ts ? new Date(ts).toISOString() : null;
}

router.get('/', (req, res) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const pools = getAllPools(limit).map((pool) => ({
      address: pool.address,
      name: pool.name,
      tvlUsd: pool.tvl_usd,
      volume24hUsd: pool.volume_24h_usd,
      positionCount: pool.position_count,
      lastIndexed: iso(pool.last_indexed),
      tokenX: { mint: pool.token_x_mint, symbol: pool.token_x_symbol },
      tokenY: { mint: pool.token_y_mint, symbol: pool.token_y_symbol },
      feeRate: pool.fee_rate,
      binStep: pool.bin_step,
    }));
    res.json({ pools, total: pools.length, lastIndexed: pools[0]?.lastIndexed || null });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
