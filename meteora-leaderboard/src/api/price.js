import { config } from '../config.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

const PYUSD_MINT = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const USDH_MINT = 'USDH1bHnY83iC2M4NXQt3g1j3NsxJfT65o4YgLQVQHt';
const SUSD_MINT = 'susd5y5U1cBzvW5rKPGQ1YwS6Y5TpbYQJ2X1KZ7s7K';
const STABLE_MINTS = new Set([USDC_MINT, USDT_MINT, PYUSD_MINT, USDH_MINT, SUSD_MINT]);
const cache = new Map();
const PRICE_TTL_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parsePricePayload(raw) {
  const rows = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
  const prices = new Map();
  for (const [mint, row] of Object.entries(rows || {})) {
    const price = Number.parseFloat(row?.price ?? row?.usdPrice);
    if (Number.isFinite(price) && price > 0) prices.set(mint, price);
  }
  return prices;
}

async function fetchJson(url, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 180)}`);
      return body ? JSON.parse(body) : {};
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Price request failed');
}

export async function getPrices(mints) {
  const unique = [...new Set((mints || []).filter(Boolean).map(String))];
  const prices = new Map();
  const missing = [];
  const now = Date.now();

  for (const mint of unique) {
    if (isStablecoin(mint)) {
      prices.set(mint, 1);
      continue;
    }
    const cached = cache.get(mint);
    if (cached && now - cached.ts < PRICE_TTL_MS) prices.set(mint, cached.price);
    else missing.push(mint);
  }

  for (let index = 0; index < missing.length; index += 100) {
    const batch = missing.slice(index, index + 100);
    if (batch.length === 0) continue;
    try {
      const url = new URL(config.jupiterPriceUrl);
      url.searchParams.set('ids', batch.join(','));
      const fresh = parsePricePayload(await fetchJson(url));
      for (const mint of batch) {
        const price = fresh.get(mint);
        if (price) {
          cache.set(mint, { price, ts: now });
          prices.set(mint, price);
        }
      }
    } catch (error) {
      console.warn(`[price] failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return prices;
}

export async function getSolPrice() {
  const prices = await getPrices([SOL_MINT]);
  return prices.get(SOL_MINT) || 150;
}

export function isStablecoin(mint) {
  return STABLE_MINTS.has(String(mint || ''));
}
