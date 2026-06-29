import cron from 'node-cron';
import { config } from '../config.js';
import { getSolPrice } from '../api/price.js';
import {
  finishIndexRun,
  insertWalletBatch,
  insertWalletPoolBatch,
  startIndexRun,
  upsertPool,
} from '../db/queries.js';
import { crawlPool, crawlTopPools } from './poolCrawler.js';

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

export function getIndexState() {
  return indexState;
}

export async function runFullIndex() {
  if (indexState.isRunning) {
    log('warn', 'Index already running');
    return indexState;
  }

  const runId = startIndexRun();
  const allWalletPnl = new Map();
  const walletPoolRows = [];
  let totalPositions = 0;

  indexState = {
    isRunning: true,
    currentRunId: runId,
    progress: { phase: 'fetching_pools', poolsDone: 0, poolsTotal: 0, walletsFound: 0, positionsProcessed: 0 },
    lastFinished: indexState.lastFinished,
    lastError: null,
  };

  try {
    const pools = await crawlTopPools();
    indexState.progress.poolsTotal = pools.length;
    for (const pool of pools) upsertPool(pool);

    indexState.progress.phase = 'computing_pnl';
    const solPrice = await getSolPrice();

    for (const pool of pools) {
      log('info', 'Crawling pool', `${pool.name} ${pool.address}`);
      const result = await crawlPool(pool.address, solPrice);
      if (result.error) {
        log('warn', 'Pool skipped', `${pool.address}: ${result.error}`);
        indexState.progress.poolsDone += 1;
        continue;
      }

      upsertPool(result.poolInfo);
      totalPositions += result.totalPositions;
      const now = Date.now();
      for (const [wallet, data] of result.walletResults) {
        walletPoolRows.push({
          wallet,
          pool_address: pool.address,
          pool_name: pool.name,
          pnl_usd: data.pnlUsd,
          pnl_sol: data.pnlSol,
          fees_earned_usd: data.feesEarnedUsd,
          deposited_usd: data.depositedUsd,
          withdrawn_usd: data.withdrawnUsd,
          position_count: data.positionCount,
          last_updated: now,
        });

        const existing = allWalletPnl.get(wallet) || {
          pnlUsd: 0,
          pnlSol: 0,
          feesEarnedUsd: 0,
          depositedUsd: 0,
          withdrawnUsd: 0,
          positionCount: 0,
          poolCount: 0,
        };
        existing.pnlUsd += data.pnlUsd || 0;
        existing.pnlSol += data.pnlSol || 0;
        existing.feesEarnedUsd += data.feesEarnedUsd || 0;
        existing.depositedUsd += data.depositedUsd || 0;
        existing.withdrawnUsd += data.withdrawnUsd || 0;
        existing.positionCount += data.positionCount || 0;
        existing.poolCount += 1;
        allWalletPnl.set(wallet, existing);
      }

      indexState.progress.poolsDone += 1;
      indexState.progress.walletsFound = allWalletPnl.size;
      indexState.progress.positionsProcessed = totalPositions;
    }

    indexState.progress.phase = 'saving';
    insertWalletPoolBatch(walletPoolRows);
    insertWalletBatch([...allWalletPnl.entries()].map(([wallet, data]) => ({
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

    finishIndexRun(runId, {
      pools_indexed: pools.length,
      wallets_found: allWalletPnl.size,
      positions_processed: totalPositions,
      status: 'success',
    });
    indexState.progress.phase = 'done';
    indexState.isRunning = false;
    indexState.lastFinished = Date.now();
    log('info', `Index complete: ${pools.length} pools, ${allWalletPnl.size} wallets, ${totalPositions} positions`);
    return indexState;
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
