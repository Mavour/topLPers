import 'dotenv/config';

const safeInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const safeFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const allowedTelegramIds = process.env.ALLOWED_TELEGRAM_IDS
  ? process.env.ALLOWED_TELEGRAM_IDS
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0)
  : [];

export const config = Object.freeze({
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || null,
  heliusApiKey: process.env.HELIUS_API_KEY || null,
  defaultPeriod: process.env.DEFAULT_PERIOD || '7',
  defaultLimit: safeInt(process.env.DEFAULT_LIMIT, 20),
  allowedTelegramIds,
  cacheTtlMs: safeInt(process.env.CACHE_TTL_SECONDS, 300) * 1000,
  solPriceOverride: process.env.SOL_PRICE_OVERRIDE ? safeFloat(process.env.SOL_PRICE_OVERRIDE, null) : null,
  datApiBase: 'https://dlmm.datapi.meteora.ag',
  legacyApiBase: 'https://dlmm-api.meteora.ag',
  requestTimeoutMs: 15_000,
  retryAttempts: 3,
  retryDelayMs: 1_500,
});
