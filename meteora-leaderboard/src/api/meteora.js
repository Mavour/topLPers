import { config } from '../config.js';
import { get as cacheGet, set as cacheSet } from '../cache/memCache.js';

const PAIR_API = process.env.METEORA_PAIR_API || 'https://dlmm-api.meteora.ag';
const DATA_API = process.env.METEORA_DATA_API || 'https://dlmm.datapi.meteora.ag';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const KNOWN_DECIMALS = new Map([
  ['So11111111111111111111111111111111111111112', 9],
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6],
  ['2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', 6],
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isValidAddress(value) {
  return typeof value === 'string' && BASE58_RE.test(value.trim());
}

export function numberFrom(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function firstDefined(row, keys) {
  for (const key of keys) {
    if (key.includes('.')) {
      const value = key.split('.').reduce((acc, part) => acc?.[part], row);
      if (value !== undefined && value !== null && value !== '') return value;
    } else if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') {
      return row[key];
    }
  }
  return null;
}

export function normalizeArray(raw, preferredKeys = []) {
  if (Array.isArray(raw)) return raw;
  for (const key of [...preferredKeys, 'data', 'items', 'results', 'events', 'positions', 'pairs', 'pools']) {
    if (Array.isArray(raw?.[key])) return raw[key];
    if (Array.isArray(raw?.data?.[key])) return raw.data[key];
  }
  return [];
}

export function tokenMint(pool, side) {
  const upper = side.toUpperCase();
  const lower = side.toLowerCase();
  return firstDefined(pool, [
    `token_${lower}_mint`,
    `token${upper}Mint`,
    `mint_${lower}`,
    `mint${upper}`,
    `token${upper}.mint`,
    `token_${lower}.mint`,
    `token${upper}.address`,
    `token_${lower}.address`,
    `mint_${lower}_address`,
  ]);
}

export function getTokenDecimals(pool, side) {
  const mint = tokenMint(pool, side);
  const known = KNOWN_DECIMALS.get(String(mint || ''));
  if (known !== undefined) return known;

  const upper = side.toUpperCase();
  const lower = side.toLowerCase();
  return numberFrom(firstDefined(pool, [
    `token_${lower}_decimals`,
    `token${upper}Decimals`,
    `token${upper}.decimals`,
    `token_${lower}.decimals`,
    `mint_${lower}_decimals`,
  ]), 9);
}

function poolTvl(pool) {
  return numberFrom(firstDefined(pool, [
    'current_tvl',
    'tvl',
    'tvl_usd',
    'tvlUsd',
    'liquidity',
    'liquidity_usd',
    'liquidityUsd',
  ]), 0);
}

function poolVolume24h(pool) {
  return numberFrom(firstDefined(pool, [
    'trade_volume_24h',
    'volume_24h',
    'volume24h',
    'volumeUsd24h',
    'volume_usd_24h',
    'volume.24h',
  ]), 0);
}

function poolVolume7d(pool) {
  return numberFrom(firstDefined(pool, [
    'trade_volume_7d',
    'volume_7d',
    'volume7d',
    'volumeUsd7d',
    'volume_usd_7d',
    'volume.7d',
  ]), 0);
}

async function request(baseUrl, path, queryParams = {}, attempt = 1) {
  const url = new URL(baseUrl + path);
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'MeteoraDLMMLeaderboard/3.0',
      },
    });
    clearTimeout(timer);

    if (response.status === 429) {
      const wait = 5000 + attempt * 1000;
      console.warn(`[meteora] rate limited, waiting ${wait}ms`);
      await sleep(wait);
      if (attempt < config.retryAttempts) return request(baseUrl, path, queryParams, attempt + 1);
      throw new Error(`Rate limited after ${attempt} attempts: ${path}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    return response.json();
  } catch (error) {
    clearTimeout(timer);
    const message = error.name === 'AbortError' ? `Timeout: ${path}` : error.message;
    if (attempt < config.retryAttempts) {
      const delay = config.retryBaseDelayMs * 2 ** (attempt - 1);
      console.warn(`[meteora] retry ${attempt}/${config.retryAttempts}: ${path}`);
      await sleep(delay);
      return request(baseUrl, path, queryParams, attempt + 1);
    }
    throw new Error(`Failed ${path}: ${message}`);
  }
}

async function tryRequest(requests) {
  let lastError;
  for (const item of requests) {
    try {
      return await request(item.baseUrl, item.path, item.params || {});
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('All Meteora requests failed');
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
    const raw = await response.text();
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}: ${raw.slice(0, 180)}`);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed.error) throw new Error(`RPC ${parsed.error.code}: ${parsed.error.message}`);
    return parsed.result;
  } finally {
    clearTimeout(timer);
  }
}

function base58Encode(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte === 0) encoded = BASE58_ALPHABET[0] + encoded;
    else break;
  }
  return encoded || BASE58_ALPHABET[0];
}

function decodePositionAccount(row) {
  const encoded = row?.account?.data?.[0];
  if (!encoded) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 72) return null;
  return { position: row.pubkey, position_address: row.pubkey, owner: base58Encode(bytes.subarray(40, 72)) };
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
  return (result || []).map(decodePositionAccount).filter(Boolean).slice(0, limit);
}

export async function getActivePools() {
  const cacheKey = 'active_pools';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const allPools = [];
  for (let page = 0; page < 5; page += 1) {
    try {
      const data = await request(DATA_API, '/pools', { page: page + 1, page_size: 100, limit: 100 });
      const pools = normalizeArray(data, ['data', 'pairs', 'pools']);
      if (!pools.length) break;
      allPools.push(...pools);
      const lastTvl = poolTvl(pools[pools.length - 1]);
      if (lastTvl < config.minTvlUsd / 2) break;
    } catch (error) {
      console.warn(`[meteora] getActivePools page ${page} failed: ${error.message}`);
      break;
    }
  }

  const filtered = allPools.filter((pool) => {
    const tvl = poolTvl(pool);
    const vol24h = poolVolume24h(pool);
    const vol7d = poolVolume7d(pool);
    if (tvl < config.minTvlUsd) return false;
    return vol24h >= config.minVolume24h || vol7d >= config.minVolume7d;
  });

  const sorted = filtered
    .sort((left, right) => poolTvl(right) - poolTvl(left))
    .slice(0, config.maxPoolsToIndex);

  console.log(`[meteora] active pools: ${filtered.length} found, using top ${sorted.length}`);
  cacheSet(cacheKey, sorted, 10 * 60 * 1000);
  return sorted;
}

export async function getTopPools(limit = config.maxPoolsToIndex) {
  const pools = await getActivePools();
  return pools.slice(0, limit);
}

export async function getPool(poolAddress) {
  const cacheKey = `pool:${poolAddress}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await request(DATA_API, `/pools/${encodeURIComponent(poolAddress)}`);
  cacheSet(cacheKey, data, 5 * 60 * 1000);
  return data;
}

export async function getPoolPositions(poolAddress, limit = config.maxPositions) {
  const cacheKey = `pool_pos:${poolAddress}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const positions = await getPoolPositionsFromRpc(poolAddress, limit);

  cacheSet(cacheKey, positions, 2 * 60 * 1000);
  return positions;
}

async function getPaginatedPortfolio(walletAddress, path, maxPages, ttlMs) {
  const cacheKey = `${path}:${walletAddress}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const all = [];
  let cursor = null;
  let page = 0;
  do {
    const params = { limit: 50 };
    if (cursor) params.cursor = cursor;
    const data = await request(DATA_API, `/portfolio/${walletAddress}/${path}`, params);
    const items = normalizeArray(data, ['data', 'items', 'positions']);
    all.push(...items);
    cursor = data?.next_cursor || data?.nextCursor || null;
    page += 1;
    if (cursor && page < maxPages) await sleep(100);
  } while (cursor && page < maxPages);

  cacheSet(cacheKey, all, ttlMs);
  return all;
}

export function getPositionDeposits() {
  return [];
}

export function getPositionWithdraws() {
  return [];
}

export function getPositionFeeClaims() {
  return [];
}

function readU64LE(bytes, offset) {
  if (!bytes || bytes.length < offset + 8) return 0;
  return Number(bytes.readBigUInt64LE(offset));
}

export async function getPositionState(positionAddress) {
  if (!isValidAddress(positionAddress)) {
    throw new Error(`Invalid position address: ${positionAddress}`);
  }

  const cacheKey = `position:${positionAddress}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const result = await rpcRequest('getAccountInfo', [
    positionAddress,
    { encoding: 'base64', dataSlice: { offset: 0, length: 16 } },
  ]);
  const encoded = result?.value?.data?.[0];
  const bytes = encoded ? Buffer.from(encoded, 'base64') : null;
  const state = {
    positionAddress,
    totalXAmount: readU64LE(bytes, 0),
    totalYAmount: readU64LE(bytes, 8),
    unclaimedFeeX: 0,
    unclaimedFeeY: 0,
    source: 'solana-rpc',
  };
  cacheSet(cacheKey, state, 60 * 1000);
  return state;
}

export async function getWalletClosedPositions(walletAddress) {
  return getPaginatedPortfolio(walletAddress, 'closed-positions', 20, 5 * 60 * 1000);
}

export async function getWalletOpenPositions(walletAddress) {
  if (!isValidAddress(walletAddress)) return [];
  return [];
}

export async function getWalletPortfolio(walletAddress) {
  const cacheKey = `portfolio:${walletAddress}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const data = await request(DATA_API, `/portfolio/${walletAddress}`);
  cacheSet(cacheKey, data, 2 * 60 * 1000);
  return data;
}
