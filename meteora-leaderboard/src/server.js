import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { config } from './config.js';
import { getSolPrice } from './api/jupiterPrice.js';
import { isValidAddress } from './api/meteoraClient.js';
import { getWalletPortfolio } from './core/walletPortfolio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function publicPath(pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const cleanPath = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, '');
  return join(publicDir, cleanPath);
}

async function handleLeaderboard(reqUrl, res) {
  void reqUrl;
  sendJson(res, 503, {
    error: 'Meteora public leaderboard API is unavailable. Wallet portfolio lookup remains available.',
  });
}

async function handleWallet(reqUrl, res) {
  const address = reqUrl.searchParams.get('address')?.trim();

  if (!address || !isValidAddress(address)) {
    sendJson(res, 400, { error: 'Invalid wallet address.' });
    return;
  }

  try {
    const [solPrice, portfolio] = await Promise.all([
      getSolPrice(),
      getWalletPortfolio(address),
    ]);

    sendJson(res, 200, {
      solPrice,
      data: portfolio,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    sendJson(res, 502, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function serveStatic(reqUrl, res) {
  const filePath = publicPath(reqUrl.pathname);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    const contentType = mimeTypes[extname(filePath)] || 'application/octet-stream';
    const extension = extname(filePath);
    const cacheControl = ['.html', '.js', '.css'].includes(extension)
      ? 'no-store'
      : 'public, max-age=3600';
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': cacheControl,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  if (reqUrl.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'meteora-leaderboard-web' });
    return;
  }

  if (reqUrl.pathname === '/api/leaderboard') {
    await handleLeaderboard(reqUrl, res);
    return;
  }

  if (reqUrl.pathname === '/api/wallet') {
    await handleWallet(reqUrl, res);
    return;
  }

  await serveStatic(reqUrl, res);
});

server.on('clientError', (error, socket) => {
  console.error('Client error:', error.message);
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

const shutdown = (signal) => {
  console.log(`Received ${signal}, shutting down web server...`);
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(config.port, () => {
  console.log(`Meteora Leaderboard web listening on http://localhost:${config.port}`);
});
