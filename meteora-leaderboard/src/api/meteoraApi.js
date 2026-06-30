import { config } from '../config.js';
import { get as cacheGet, set as cacheSet } from '../cache/memCache.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_HISTORY_PAGES = Number.parseInt(process.env.MAX_POSITION_HISTORY_PAGES, 10) || 50;

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

export const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidAddress(value) {
  return typeof value === 'string' && BASE58_RE.test(value.trim());
}

export function numberFrom(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function firstDefined(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') {
      return row[key];
    }
  }
  return null;
}

export function normalizeArray(raw, preferredKeys = []) {
  if (Array.isArray(raw)) {
    return raw;
  }

  for (const key of preferredKeys) {
    if (Array.isArray(raw?.[key])) {
      return raw[key];
    }
  }

  for (const key of ['data', 'items', 'results', 'events', 'positions', 'pairs', 'pools']) {
    if (Array.isArray(raw?.[key])) {
      return raw[key];
    }
    if (Array.isArray(raw?.data?.[key])) {
      return raw.data[key];
    }
  }

  return [];
}

function base58Encode(bytes) {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  let encoded = '';
  while (value > 0n) {
    const mod = Number(value % 58n);
    encoded = BASE58_ALPHABET[mod] + encoded;
    value /= 58n;
  }

  for (const byte of bytes) {
    if (byte === 0) {
      encoded = BASE58_ALPHABET[0] + encoded;
    } else {
      break;
    }
  }

  return encoded || BASE58_ALPHABET[0];
}

async function request(path, params = {}) {
  const url = new URL(`${config.meteoraApiBase}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  let lastError = null;

  for (let attempt = 1; attempt <= config.retryAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
      }

      return body ? JSON.parse(body) : null;
    } catch (error) {
      lastError = error;
      if (attempt < config.retryAttempts) {
        console.error(`Retry ${attempt}/${config.retryAttempts}: ${url}`);
        await sleep(config.retryBaseDelayMs * 2 ** (attempt - 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Meteora request failed for ${url}: ${lastError?.message || 'unknown error'}`);
}

async function rpcRequest(method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(config.solanaRpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    const body = await response.text();

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Solana RPC rate limit exceeded. Set HELIUS_API_KEY or SOLANA_RPC_URL in .env, then restart PM2.');
      }
      throw new Error(`RPC HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const parsed = body ? JSON.parse(body) : {};
    if (parsed.error?.code === 429 || /rate limit/i.test(parsed.error?.message || '')) {
      throw new Error('Solana RPC rate limit exceeded. Set HELIUS_API_KEY or SOLANA_RPC_URL in .env, then restart PM2.');
    }
    if (parsed.error) {
      throw new Error(`RPC ${parsed.error.code}: ${parsed.error.message}`);
    }
    return parsed.result;
  } finally {
    clearTimeout(timer);
  }
}

function nestedFirst(row, keys) {
  for (const key of keys) {
    if (key.includes('.')) {
      const value = key.split('.').reduce((acc, part) => acc?.[part], row);
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    } else {
      const value = firstDefined(row, [key]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function eventType(event) {
  return String(event?.eventType || event?.type || '').toLowerCase();
}

function isAddEvent(event) {
  return ['add', 'deposit', 'add_liquidity', 'increase_liquidity'].includes(eventType(event));
}

function isRemoveEvent(event) {
  return ['remove', 'withdraw', 'remove_liquidity', 'decrease_liquidity', 'close_position'].includes(eventType(event));
}

function isFeeEvent(event) {
  const type = eventType(event);
  return ['claim_fee', 'claim_fees', 'fee_claim', 'fee_claimed', 'claim', 'swap'].includes(type)
    || (type.includes('fee') && type.includes('claim'));
}

function nextHistoryPage(raw, page, eventCount) {
  const explicit = nestedFirst(raw, ['nextPage', 'next_page', 'pagination.nextPage', 'pagination.next_page']);
  const parsed = Number.parseInt(explicit, 10);
  if (Number.isFinite(parsed) && parsed !== page) return parsed;

  const hasMore = nestedFirst(raw, [
    'hasNextPage',
    'has_next_page',
    'hasMore',
    'has_more',
    'pagination.hasNextPage',
    'pagination.has_next_page',
    'pagination.hasMore',
    'pagination.has_more',
  ]);
  if (hasMore === true || hasMore === 'true') return page + 1;

  return eventCount > 0 && eventCount >= 100 ? page + 1 : null;
}

async function cached(key, ttlMs, loader) {
  const existing = cacheGet(key);
  if (existing !== null) {
    return existing;
  }

  const value = await loader();
  cacheSet(key, value, ttlMs);
  return value;
}

function decodePositionAccount(row) {
  const encoded = row?.account?.data?.[0];
  if (!encoded) {
    return null;
  }

  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 72) {
    return null;
  }

  return {
    position: row.pubkey,
    owner: base58Encode(bytes.subarray(40, 72)),
    source: 'solana-rpc',
  };
}

async function getPoolPositionsFromRpc(poolAddress, limit) {
  const result = await rpcRequest('getProgramAccounts', [
    config.dlmmProgramId,
    {
      encoding: 'base64',
      dataSlice: { offset: 0, length: 72 },
      filters: [{ memcmp: { offset: 8, bytes: poolAddress } }],
    },
  ]);

  return (result || [])
    .map(decodePositionAccount)
    .filter(Boolean)
    .slice(0, limit);
}

async function getWalletPoolPositionsFromRpc(poolAddress, walletAddress, limit) {
  const result = await rpcRequest('getProgramAccounts', [
    config.dlmmProgramId,
    {
      encoding: 'base64',
      dataSlice: { offset: 0, length: 72 },
      filters: [
        { memcmp: { offset: 8, bytes: poolAddress } },
        { memcmp: { offset: 40, bytes: walletAddress } },
      ],
    },
  ]);

  return (result || [])
    .map(decodePositionAccount)
    .filter(Boolean)
    .slice(0, limit);
}

async function getPositionHistory(positionAddress) {
  return cached(`history:${positionAddress}`, 10 * 60_000, async () => {
    const events = [];
    let page = 0;
    const seenPages = new Set();
    while (!seenPages.has(page) && seenPages.size < MAX_HISTORY_PAGES) {
      seenPages.add(page);
      const raw = await request(`/positions/${encodeURIComponent(positionAddress)}/historical`, { page, limit: 100 });
      const pageEvents = normalizeArray(raw, ['events']);
      events.push(...pageEvents);
      const nextPage = nextHistoryPage(raw, page, pageEvents.length);
      if (nextPage === null || !pageEvents.length) break;
      page = nextPage;
      await sleep(100);
    }
    return events;
  });
}

export async function getPool(poolAddress) {
  if (!isValidAddress(poolAddress)) {
    throw new Error(`Invalid pool address: ${poolAddress}`);
  }

  return cached(`pool:${poolAddress}`, 5 * 60_000, () => request(`/pools/${encodeURIComponent(poolAddress)}`));
}

export async function getPoolPositions(poolAddress, limit = 100) {
  if (!isValidAddress(poolAddress)) {
    throw new Error(`Invalid pool address: ${poolAddress}`);
  }

  const cappedLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 100, 1000));
  return cached(`positions:${poolAddress}:${cappedLimit}`, 2 * 60_000, async () => {
    return getPoolPositionsFromRpc(poolAddress, cappedLimit);
  });
}

export async function getWalletPoolPositions(poolAddress, walletAddress, limit = 100) {
  if (!isValidAddress(poolAddress)) {
    throw new Error(`Invalid pool address: ${poolAddress}`);
  }
  if (!isValidAddress(walletAddress)) {
    throw new Error(`Invalid wallet address: ${walletAddress}`);
  }

  const cappedLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 100, 1000));
  return cached(`wallet-positions:${poolAddress}:${walletAddress}:${cappedLimit}`, 30_000, async () => {
    return getWalletPoolPositionsFromRpc(poolAddress, walletAddress, cappedLimit);
  });
}

export async function getPositionDeposits(positionAddress) {
  if (!isValidAddress(positionAddress)) {
    throw new Error(`Invalid position address: ${positionAddress}`);
  }

  return cached(`deposits:${positionAddress}`, 10 * 60_000, async () => {
    const events = await getPositionHistory(positionAddress);
    return events.filter(isAddEvent);
  });
}

export async function getPositionWithdraws(positionAddress) {
  if (!isValidAddress(positionAddress)) {
    throw new Error(`Invalid position address: ${positionAddress}`);
  }

  return cached(`withdraws:${positionAddress}`, 10 * 60_000, async () => {
    const events = await getPositionHistory(positionAddress);
    return events.filter(isRemoveEvent);
  });
}

export async function getPositionFeeClaims(positionAddress) {
  if (!isValidAddress(positionAddress)) {
    throw new Error(`Invalid position address: ${positionAddress}`);
  }

  return cached(`fee-claims:${positionAddress}`, 10 * 60_000, async () => {
    const events = await getPositionHistory(positionAddress);
    return events.filter(isFeeEvent);
  });
}

export async function getPositionState(positionAddress) {
  if (!isValidAddress(positionAddress)) {
    throw new Error(`Invalid position address: ${positionAddress}`);
  }

  return cached(`position:${positionAddress}`, 60_000, async () => {
    const result = await rpcRequest('getAccountInfo', [
      positionAddress,
      { encoding: 'base64', dataSlice: { offset: 0, length: 16 } },
    ]);
    const encoded = result?.value?.data?.[0];
    const bytes = encoded ? Buffer.from(encoded, 'base64') : null;
    return {
      positionAddress,
      totalXAmount: bytes && bytes.length >= 8 ? Number(bytes.readBigUInt64LE(0)) : 0,
      totalYAmount: bytes && bytes.length >= 16 ? Number(bytes.readBigUInt64LE(8)) : 0,
      unclaimedFeeX: 0,
      unclaimedFeeY: 0,
      source: 'solana-rpc',
    };
  });
}

export async function getAllPoolsPage(page = 0, limit = 50) {
  const safePage = Math.max(0, Number.parseInt(page, 10) || 0);
  const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 50, 100));
  return cached(`pools:${safePage}:${safeLimit}`, 5 * 60_000, async () => {
    const raw = await request('/pools', { page: safePage + 1, page_size: safeLimit });
    return normalizeArray(raw, ['data', 'pools']);
  });
}

function poolSearchText(pool) {
  return [
    pool?.address,
    pool?.pubkey,
    pool?.pair_address,
    pool?.name,
    pool?.symbol,
    pool?.token_x?.address,
    pool?.token_y?.address,
    pool?.token_x?.symbol,
    pool?.token_y?.symbol,
    pool?.tokenX?.symbol,
    pool?.tokenY?.symbol,
    pool?.token_x_mint,
    pool?.token_y_mint,
    pool?.mint_x,
    pool?.mint_y,
  ].filter(Boolean).join(' ').toLowerCase();
}

export async function searchPools(query, limit = 20) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const pools = await getAllPoolsPage(0, 100);
  return pools
    .filter((pool) => poolSearchText(pool).includes(needle))
    .slice(0, Math.max(1, Number.parseInt(limit, 10) || 20));
}
