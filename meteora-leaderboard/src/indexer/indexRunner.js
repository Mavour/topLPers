import cron from 'node-cron';
import { config } from '../config.js';
import {
  batchUpsertWalletPnl,
  finishIndexRun,
  startIndexRun,
  upsertWalletPoolPnl,
  upsertWalletPosition,
  upsertPool,
} from '../db/queries.js';
import { crawlAll } from './poolCrawler.js';

let indexState = {
  isRunning: false,
  currentRunId: null,
  progress: { phase: '', poolsDone: 0, poolsTotal: 0, walletsFound: 0, positionsProcessed: 0 },
  lastFinished: null,
  lastError: null,
};

function log(level, msg, data = '') {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}`, data || '');
}

function toMs(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function setupJson(position) {
  const lines = [];
  if (position.binRange) lines.push(`BIN RANGE ${position.binRange}`);
  return JSON.stringify(lines);
}

export function getIndexState() {
  return indexState;
}

export async function runFullIndex() {
  if (indexState.isRunning) {
    console.warn('[indexer] already running, skipping');
    return;
  }

  indexState.isRunning = true;
  indexState.lastError = null;
  indexState.progress = { phase: 'starting', poolsDone: 0, poolsTotal: 0, walletsFound: 0, positionsProcessed: 0 };

  const runId = startIndexRun();
  indexState.currentRunId = runId;

  try {
    indexState.progress.phase = 'crawling';

    const result = await crawlAll((progress) => {
      indexState.progress = {
        phase: progress.phase || 'computing_pnl',
        poolsDone: indexState.progress.poolsDone,
        poolsTotal: indexState.progress.poolsTotal,
        walletsFound: progress.walletsFound || 0,
        positionsProcessed: progress.done || 0,
      };
    });
    indexState.progress.poolsDone = result.pools.length;
    indexState.progress.poolsTotal = result.pools.length;

    indexState.progress.phase = 'saving';

    for (const pool of result.pools) {
      upsertPool({
        address: pool.address,
        name: pool.name || `${pool.mint_x_symbol || '?'} / ${pool.mint_y_symbol || '?'}`,
        token_x_mint: pool.mint_x || pool.token_x_mint || '',
        token_y_mint: pool.mint_y || pool.token_y_mint || '',
        token_x_symbol: pool.mint_x_symbol || pool.token_x_symbol || '',
        token_y_symbol: pool.mint_y_symbol || pool.token_y_symbol || '',
        bin_step: pool.bin_step || 0,
        fee_rate: pool.base_fee_percentage || pool.fee_rate || 0,
        tvl_usd: Number.parseFloat(pool.current_tvl || pool.tvl || pool.tvl_usd || 0) || 0,
        volume_24h_usd: Number.parseFloat(pool.trade_volume_24h || pool.volume_24h || pool.volume_24h_usd || 0) || 0,
        last_indexed: Date.now(),
        position_count: 0,
      });
    }

    const walletArray = Array.from(result.walletPnls.entries());
    const batchSize = 500;
    for (let index = 0; index < walletArray.length; index += batchSize) {
      const batch = walletArray.slice(index, index + batchSize);
      batchUpsertWalletPnl(batch.map(([wallet, data]) => ({
        wallet,
        pnl_usd: data.pnlUsd,
        pnl_sol: data.pnlSol,
        fees_earned_usd: data.feesEarnedUsd,
        deposited_usd: data.depositedUsd,
        withdrawn_usd: data.withdrawnUsd,
        position_count: data.positionCount,
        pool_count: data.poolCount,
        last_updated: Date.now(),
      })));

      for (const [wallet, data] of batch) {
        for (const pool of data.poolBreakdown) {
          const createdTimes = [...pool.openPositions, ...pool.closedPositions]
            .map((position) => Number.parseInt(position.createdAt, 10))
            .filter((value) => Number.isFinite(value) && value > 0);
          upsertWalletPoolPnl({
            wallet,
            pool_address: pool.poolAddress,
            pool_name: pool.poolName || pool.poolAddress.slice(0, 8),
            pnl_usd: pool.pnlUsd,
            pnl_sol: pool.pnlSol,
            fees_earned_usd: pool.feesUsd,
            deposited_usd: pool.depositedUsd,
            withdrawn_usd: pool.withdrawnUsd,
            position_count: pool.positionCount,
            has_open: pool.openPositions.length > 0 ? 1 : 0,
            created_at: createdTimes.length ? Math.min(...createdTimes) : null,
            last_updated: Date.now(),
          });

          for (const position of [...pool.openPositions, ...pool.closedPositions]) {
            const isOpen = Boolean(position.isActive);
            upsertWalletPosition({
              wallet,
              position_address: position.positionAddress,
              pool_address: pool.poolAddress,
              pool_name: pool.poolName || pool.poolAddress.slice(0, 8),
              status: isOpen ? 'open' : 'closed',
              pnl_usd: position.pnlUsd,
              pnl_sol: position.pnlSol,
              fees_usd: position.feesUsd,
              deposited_usd: position.depositedUsd,
              withdrawn_usd: position.withdrawnUsd,
              current_value_usd: position.currentValueUsd,
              created_at: toMs(position.createdAt),
              closed_at: toMs(position.closedAt),
              duration_seconds: position.durationSeconds,
              bin_range: position.binRange,
              setup_json: setupJson(position),
              last_updated: Date.now(),
            });
          }
        }
      }
    }

    finishIndexRun(runId, {
      pools_indexed: result.pools.length,
      wallets_found: result.walletPnls.size,
      positions_processed: result.totalWallets,
      status: 'success',
    });
    indexState.progress.phase = 'done';
    indexState.isRunning = false;
    indexState.lastFinished = Date.now();
    console.log(`Index complete: ${result.pools.length} pools, ${result.walletPnls.size} wallets`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishIndexRun(runId, { status: 'error', error_message: message });
    indexState.isRunning = false;
    indexState.lastError = message;
    log('error', 'Index run failed', message);
    return indexState;
  }
}

export function setupCron() {
  cron.schedule(config.cronSchedule, () => {
    log('info', 'Cron triggered index run');
    runFullIndex().catch((error) => log('error', 'Cron index error', error.message));
  });
  log('info', `Cron scheduled: ${config.cronSchedule}`);
}
