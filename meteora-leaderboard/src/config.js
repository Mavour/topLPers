import 'dotenv/config';

const intFromEnv = (name, fallback) => {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = Object.freeze({
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || null,
  defaultPool: process.env.DEFAULT_POOL || '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',
  maxPositions: intFromEnv('MAX_POSITIONS_PER_POOL', 100),
  concurrency: intFromEnv('CONCURRENCY', 5),
  cacheTtlMs: intFromEnv('CACHE_TTL', 300) * 1000,
  allowedUserIds: (process.env.ALLOWED_USER_IDS || '')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0),
  heliusApiKey: process.env.HELIUS_API_KEY || null,
  apiBase: 'https://dlmm.datapi.meteora.ag',
  poolDiscoveryBase: 'https://pool-discovery-api.datapi.meteora.ag',
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  dlmmProgramId: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  jupiterPriceUrl: 'https://api.jup.ag/price/v3',
  requestTimeoutMs: 15_000,
  retryAttempts: 3,
  retryBaseDelayMs: 1000,
});
