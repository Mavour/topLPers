import { config } from '../config.js';

let cached = { price: 150, ts: 0 };

const CACHE_MS = 60_000;
const FALLBACK_SOL_PRICE = 150;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_URLS = [
  `https://api.jup.ag/price/v3?ids=${SOL_MINT}`,
  `https://price.jup.ag/v6/price?ids=${SOL_MINT}`,
];

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const safePrice = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Jupiter returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getSolPrice() {
  if (config.solPriceOverride) {
    return config.solPriceOverride;
  }

  if (Date.now() - cached.ts < CACHE_MS) {
    return cached.price;
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const url = JUPITER_URLS[attempt - 1] || JUPITER_URLS[0];
      const raw = await fetchWithTimeout(url, 8_000);
      const price = safePrice(raw?.[SOL_MINT]?.usdPrice) || safePrice(raw?.data?.[SOL_MINT]?.price);

      if (!price) {
        throw new Error('Jupiter response did not include a valid SOL price');
      }

      cached = { price, ts: Date.now() };
      return price;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[jupiter] Attempt ${attempt}/2 failed: ${message}`);

      if (attempt < 2) {
        await sleep(2_000);
      }
    }
  }

  cached = { price: cached.price || FALLBACK_SOL_PRICE, ts: Date.now() };
  return cached.price;
}
