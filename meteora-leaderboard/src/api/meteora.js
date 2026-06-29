import { config } from '../config.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const positionStateCache = new Map();

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

async function request(path, queryParams = {}) {
  const url = new URL(`${config.meteoraApiBase}${path}`);
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  let lastError;
  for (let attempt = 1; attempt <= config.retryAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      const body = await response.text();
      if (response.status === 429 && attempt < config.retryAttempts) await sleep(5_000);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
      return body ? JSON.parse(body) : {};
    } catch (error) {
      lastError = error;
      if (attempt < config.retryAttempts) {
        console.warn(`[meteora] retry ${attempt}/${config.retryAttempts}: ${path}`);
        await sleep(1000 * 2 ** (attempt - 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Meteora request failed ${path}: ${lastError?.message || 'unknown error'}`);
}

async function tryRequest(paths) {
  let lastError;
  for (const { path, params } of paths) {
    try {
      return await request(path, params);
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

function decodePositionStateFromAccount(data) {
  if (!data) return null;
  try {
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length < 96) return null;
    const readU64 = (buf, offset) => {
      let value = 0n;
      for (let index = 7; index >= 0; index -= 1) {
        value = (value << 8n) + BigInt(buf[offset + index]);
      }
      return value;
    };

    return {
      totalXAmount: Number(readU64(bytes, 0)),
      totalYAmount: Number(readU64(bytes, 8)),
      unclaimedFeeX: Number(readU64(bytes, 16)),
      unclaimedFeeY: Number(readU64(bytes, 24)),
      amountsAreRaw: true,
      source: 'solana-rpc',
    };
  } catch {
    return null;
  }
}

async function getFullPositionStateFromRpc(positionAddress) {
  const cacheKey = `fullpos:${positionAddress}`;
  const cached = positionStateCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 30_000) return cached.value;

  let value = null;
  try {
    const result = await rpcRequest('getAccountInfo', [
      positionAddress,
      { encoding: 'base64', dataSlice: { offset: 0, length: 96 } },
    ]);
    value = decodePositionStateFromAccount(result?.value?.data?.[0]);
  } catch {
    value = null;
  }

  positionStateCache.set(cacheKey, { value, ts: Date.now() });
  return value;
}

function decodePositionAccount(row) {
  const encoded = row?.account?.data?.[0];
  if (!encoded) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 72) return null;
  return { position: row.pubkey, owner: base58Encode(bytes.subarray(40, 72)) };
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

export async function getTopPools(limit = 50) {
  const raw = await tryRequest([
    { path: '/pair/all', params: { page: 0, limit, sort_key: 'tvl', order_by: 'desc' } },
    { path: '/pools', params: { page: 1, page_size: Math.min(limit, 100) } },
  ]);
  return normalizeArray(raw, ['data', 'pairs', 'pools'])
    .sort((left, right) => numberFrom(firstDefined(right, ['current_tvl', 'tvl', 'liquidity'])) - numberFrom(firstDefined(left, ['current_tvl', 'tvl', 'liquidity'])))
    .slice(0, limit);
}

export async function getPoolPositions(poolAddress, limit = 200) {
  if (!isValidAddress(poolAddress)) throw new Error(`Invalid pool address: ${poolAddress}`);
  try {
    const raw = await request(`/pair/${encodeURIComponent(poolAddress)}/positions`, { limit });
    const apiPositions = normalizeArray(raw, ['positions']);
    if (apiPositions.length > 0) return apiPositions.slice(0, limit);
  } catch (error) {
    console.warn(`[meteora] positions API fallback to RPC: ${error.message}`);
  }
  return getPoolPositionsFromRpc(poolAddress, limit);
}

async function getPositionHistory(positionAddress) {
  const raw = await request(`/positions/${encodeURIComponent(positionAddress)}/historical`);
  return normalizeArray(raw, ['events']);
}

export async function getPositionDeposits(positionAddress) {
  const events = await getPositionHistory(positionAddress);
  return events.filter((event) => String(event.eventType || event.type || '').toLowerCase() === 'add');
}

export async function getPositionWithdraws(positionAddress) {
  const events = await getPositionHistory(positionAddress);
  return events.filter((event) => String(event.eventType || event.type || '').toLowerCase() === 'remove');
}

export async function getPositionFeeClaims(positionAddress) {
  const events = await getPositionHistory(positionAddress);
  return events.filter((event) => String(event.eventType || event.type || '').toLowerCase() === 'claim_fee');
}

export async function getPositionState(positionAddress) {
  const rpcState = await getFullPositionStateFromRpc(positionAddress);
  if (rpcState) return rpcState;

  try {
    return await tryRequest([
      { path: `/position/${encodeURIComponent(positionAddress)}` },
      { path: `/positions/${encodeURIComponent(positionAddress)}` },
    ]);
  } catch {
    return {};
  }
}

export async function getPool(poolAddress) {
  if (!isValidAddress(poolAddress)) throw new Error(`Invalid pool address: ${poolAddress}`);
  return tryRequest([
    { path: `/pair/${encodeURIComponent(poolAddress)}` },
    { path: `/pools/${encodeURIComponent(poolAddress)}` },
  ]);
}

export async function getWalletOpenPositions(wallet) {
  if (!isValidAddress(wallet)) throw new Error(`Invalid wallet address: ${wallet}`);
  return [];
}
