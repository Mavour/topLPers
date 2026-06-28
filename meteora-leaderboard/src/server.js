import 'dotenv/config';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { config } from './config.js';
import { buildPoolLeaderboard, buildWalletPoolPnl } from './core/leaderboard.js';
import { getTopPools, searchPool } from './core/poolScanner.js';
import { isValidAddress } from './api/meteoraApi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = normalize(join(__dirname, '..', 'public'));

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, error) {
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, status, { ok: false, error: message });
}

function parseLimit(value, fallback = 20) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : fallback;
}

function parsePool(value) {
  const pool = value || config.defaultPool;
  if (!isValidAddress(pool)) {
    throw new Error(`Invalid pool address: ${pool}`);
  }
  return pool;
}

function parseMode(value) {
  return String(value || 'winners').toLowerCase() === 'losers' ? 'losers' : 'winners';
}

async function leaderboardFromQuery(searchParams) {
  return buildPoolLeaderboard(parsePool(searchParams.get('pool')), {
    mode: parseMode(searchParams.get('mode')),
    limit: parseLimit(searchParams.get('limit'), 20),
    concurrency: config.concurrency,
    noCache: searchParams.get('refresh') === '1',
  });
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'meteora-leaderboard-web' });
    return;
  }

  if (url.pathname === '/api/leaderboard') {
    const result = await leaderboardFromQuery(url.searchParams);
    sendJson(res, 200, { ok: true, result });
    return;
  }

  if (url.pathname === '/api/wallet') {
    const wallet = url.searchParams.get('wallet');
    if (!isValidAddress(wallet)) {
      throw new Error('Valid wallet address is required');
    }
    const result = await buildWalletPoolPnl(parsePool(url.searchParams.get('pool')), wallet, {
      limit: parseLimit(url.searchParams.get('limit'), 200),
      concurrency: config.concurrency,
    });
    const row = result.rankings.find((item) => item.wallet === wallet);
    sendJson(res, 200, { ok: true, wallet, pool: result.pool, meta: result.meta, row: row || null });
    return;
  }

  if (url.pathname === '/api/pool-pnl') {
    const result = await buildPoolLeaderboard(parsePool(url.searchParams.get('pool')), {
      mode: 'winners',
      limit: parseLimit(url.searchParams.get('limit'), 200),
      concurrency: config.concurrency,
      noCache: url.searchParams.get('refresh') === '1',
    });
    const totals = result.rankings.reduce((acc, row) => {
      acc.pnlUsd += row.pnlUsd || 0;
      acc.pnlSol += row.pnlSol || 0;
      acc.feesEarnedUsd += row.feesEarnedUsd || 0;
      acc.totalDepositedUsd += row.totalDepositedUsd || 0;
      acc.totalWithdrawnUsd += row.totalWithdrawnUsd || 0;
      acc.positionCount += row.positionCount || 0;
      return acc;
    }, {
      pnlUsd: 0,
      pnlSol: 0,
      feesEarnedUsd: 0,
      totalDepositedUsd: 0,
      totalWithdrawnUsd: 0,
      positionCount: 0,
    });
    sendJson(res, 200, { ok: true, pool: result.pool, meta: result.meta, totals });
    return;
  }

  if (url.pathname === '/api/top-pools') {
    const pools = await getTopPools(parseLimit(url.searchParams.get('limit'), 20));
    sendJson(res, 200, { ok: true, pools });
    return;
  }

  if (url.pathname === '/api/search') {
    const query = url.searchParams.get('q') || '';
    const pools = query ? await searchPool(query) : [];
    sendJson(res, 200, { ok: true, pools });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'API route not found' });
}

async function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(publicDir, requested));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { ok: false, error: 'Forbidden' });
    return;
  }

  try {
    const body = await readFile(filePath);
    const type = contentTypes[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  } catch {
    const fallback = await readFile(join(publicDir, 'index.html'));
    res.writeHead(200, { 'content-type': contentTypes['.html'] });
    res.end(fallback);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (error) {
    sendError(res, 500, error);
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Meteora leaderboard web listening on 0.0.0.0:${config.port}`);
});
