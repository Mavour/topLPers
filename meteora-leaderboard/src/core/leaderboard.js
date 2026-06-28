import { config } from '../config.js';
import { fetchGlobalLeaderboard, fetchPoolLeaderboard, safeInt } from '../api/meteoraClient.js';

const cache = new Map();

const normalizeMode = (mode) => (String(mode).toLowerCase() === 'losers' ? 'losers' : 'winners');

const normalizeLimit = (limit) => {
  const parsed = safeInt(limit);
  return parsed > 0 ? Math.min(parsed, 100) : config.defaultLimit;
};

function isCacheValid(entry) {
  return entry && Date.now() - entry.ts < config.cacheTtlMs;
}

function sortRows(rows, mode) {
  const direction = mode === 'losers' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftScore = left.pnlUsd || left.pnlSol || 0;
    const rightScore = right.pnlUsd || right.pnlSol || 0;
    return (leftScore - rightScore) * direction;
  });
}

export function clearLeaderboardCache() {
  cache.clear();
}

export async function getLeaderboard({ pool = null, period = config.defaultPeriod, limit = config.defaultLimit, mode = 'winners' } = {}) {
  const normalizedMode = normalizeMode(mode);
  const normalizedLimit = normalizeLimit(limit);
  const normalizedPeriod = String(period || config.defaultPeriod).toLowerCase();
  const cacheKey = JSON.stringify({
    pool: pool || null,
    period: normalizedPeriod,
    mode: normalizedMode,
    limit: normalizedLimit,
  });
  const cached = cache.get(cacheKey);

  if (isCacheValid(cached)) {
    return cached.data;
  }

  try {
    const rows = pool
      ? await fetchPoolLeaderboard(pool, normalizedLimit)
      : await fetchGlobalLeaderboard(normalizedPeriod, normalizedLimit);
    const data = sortRows(rows, normalizedMode).slice(0, normalizedLimit);

    cache.set(cacheKey, { data, ts: Date.now() });
    return data;
  } catch (error) {
    throw new Error(`Unable to fetch ${pool ? 'pool' : 'global'} leaderboard: ${error instanceof Error ? error.message : String(error)}`);
  }
}
