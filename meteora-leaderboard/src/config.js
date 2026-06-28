import 'dotenv/config';

const safeInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const safeFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = Object.freeze({
  heliusApiKey: process.env.HELIUS_API_KEY || null,
  port: safeInt(process.env.PORT, 3000),
  defaultPeriod: process.env.DEFAULT_PERIOD || '7',
  defaultLimit: safeInt(process.env.DEFAULT_LIMIT, 20),
  cacheTtlMs: safeInt(process.env.CACHE_TTL_SECONDS, 300) * 1000,
  solPriceOverride: process.env.SOL_PRICE_OVERRIDE ? safeFloat(process.env.SOL_PRICE_OVERRIDE, null) : null,
  datApiBase: 'https://dlmm.datapi.meteora.ag',
  legacyApiBase: 'https://dlmm-api.meteora.ag',
  requestTimeoutMs: 15_000,
  retryAttempts: 3,
  retryDelayMs: 1_500,
});
