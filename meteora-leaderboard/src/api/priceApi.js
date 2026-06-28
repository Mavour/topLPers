import { config } from '../config.js';
import { get as cacheGet, set as cacheSet } from '../cache/memCache.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const PRICE_TTL_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

async function fetchJsonWithRetry(url, attempts = 2, timeoutMs = 8000) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
      }

      return body ? JSON.parse(body) : {};
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(500 * 2 ** (attempt - 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('Jupiter price request failed');
}

function parsePricePayload(raw) {
  const rows = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
  const prices = new Map();

  for (const [mint, row] of Object.entries(rows)) {
    const price = Number.parseFloat(row?.price ?? row?.usdPrice);
    if (Number.isFinite(price) && price > 0) {
      prices.set(mint, price);
    }
  }

  return prices;
}

export async function getTokenPrices(mintAddresses) {
  const uniqueMints = [...new Set((mintAddresses || []).filter(Boolean).map(String))];
  const prices = new Map();
  const missing = [];

  for (const mint of uniqueMints) {
    const cached = cacheGet(`price:${mint}`);
    if (cached !== null) {
      prices.set(mint, cached);
    } else {
      missing.push(mint);
    }
  }

  if (missing.length === 0) {
    return prices;
  }

  try {
    const url = new URL(config.jupiterPriceUrl);
    url.searchParams.set('ids', missing.join(','));
    const raw = await fetchJsonWithRetry(url, 2, 8000);
    const freshPrices = parsePricePayload(raw);

    for (const mint of missing) {
      const price = freshPrices.get(mint);
      if (price) {
        cacheSet(`price:${mint}`, price, PRICE_TTL_MS);
        prices.set(mint, price);
      }
    }
  } catch (error) {
    console.error(`[price] Jupiter fallback to empty price map: ${error instanceof Error ? error.message : String(error)}`);
  }

  return prices;
}

export async function getSolPrice() {
  const prices = await getTokenPrices([SOL_MINT]);
  return prices.get(SOL_MINT) || 150;
}
