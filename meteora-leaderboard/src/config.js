import 'dotenv/config';

function intFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function floatFromEnv(name, fallback) {
  const parsed = Number.parseFloat(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = Object.freeze({
  port: intFromEnv('PORT', 3001),
  topPoolsLimit: intFromEnv('TOP_POOLS_LIMIT', 50),
  maxPositionsPerPool: intFromEnv('MAX_POSITIONS_PER_POOL', 200),
  maxPositions: intFromEnv('MAX_POSITIONS_PER_POOL', 200),
  concurrency: Math.min(intFromEnv('CONCURRENCY', 6), 10),
  cronSchedule: process.env.CRON_SCHEDULE || '0 * * * *',
  adminToken: process.env.ADMIN_TOKEN || 'ganti_ini_dengan_random_string',
  dbPath: process.env.DB_PATH || './leaderboard.db',
  meteoraApiBase: process.env.METEORA_API_BASE || 'https://dlmm.datapi.meteora.ag',
  jupiterPriceUrl: process.env.JUPITER_PRICE_URL || 'https://api.jup.ag/price/v3',
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  dlmmProgramId: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  requestTimeoutMs: intFromEnv('REQUEST_TIMEOUT_MS', 15_000),
  retryAttempts: intFromEnv('RETRY_ATTEMPTS', 3),
  retryBaseDelayMs: intFromEnv('RETRY_BASE_DELAY_MS', 1000),
  minTvlUsd: floatFromEnv('MIN_TVL_USD', 10_000),
  minVolume24h: floatFromEnv('MIN_VOLUME_24H_USD', 1_000),
  minVolume7d: floatFromEnv('MIN_VOLUME_7D_USD', 5_000),
  maxPoolsToIndex: intFromEnv('MAX_POOLS_TO_INDEX', 300),
});

if (config.adminToken === 'ganti_ini_dengan_random_string') {
  console.warn('[config] ADMIN_TOKEN masih default. Set ADMIN_TOKEN di .env sebelum expose server.');
}
