import { fetchWalletPortfolio, isValidAddress, safeFloat, safeInt } from '../api/meteoraClient.js';

const CACHE_TTL_MS = 120_000;
const cache = new Map();

const firstPresent = (row, keys) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') {
      return row[key];
    }
  }
  return null;
};

const numberFrom = (row, keys) => safeFloat(firstPresent(row, keys));

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', 'in_range', 'in-range', 'active', '1'].includes(normalized)) {
    return true;
  }
  if (['false', 'no', 'out_of_range', 'out-of-range', 'oor', '0'].includes(normalized)) {
    return false;
  }
  return false;
};

const shorten = (value) => {
  if (!value || typeof value !== 'string') {
    return 'Unknown pool';
  }
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
};

const collectArrays = (value, depth = 0) => {
  if (depth > 4 || value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return [value];
  }
  if (typeof value !== 'object') {
    return [];
  }

  const priorityKeys = ['positions', 'pools', 'data', 'portfolio', 'items', 'result', 'results'];
  const priorityArrays = priorityKeys.flatMap((key) => collectArrays(value[key], depth + 1));
  if (priorityArrays.length > 0) {
    return priorityArrays;
  }
  return Object.values(value).flatMap((child) => collectArrays(child, depth + 1));
};

const choosePositionRows = (raw) => {
  const rows = collectArrays(raw)
    .flat()
    .filter((row) => row && typeof row === 'object')
    .filter((row) => firstPresent(row, ['poolAddress', 'pool_address', 'pairAddress', 'pair_address', 'tokenX', 'tokenY']));
  const seen = new Set();

  return rows.filter((row, index) => {
    const poolAddress = String(firstPresent(row, ['poolAddress', 'pool_address', 'pairAddress', 'pair_address', 'address']) || '');
    const key = `${poolAddress}:${firstPresent(row, ['lastClosedAt', 'openPositionCount', 'pnlUsd', 'pnl']) ?? index}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const normalizePool = (row) => {
  const poolAddress = String(firstPresent(row, [
    'poolAddress',
    'pool_address',
    'pairAddress',
    'pair_address',
    'address',
    'pool',
    'lbPair',
    'lb_pair',
  ]) || row?.pool?.address || row?.pair?.address || '');
  const name = String(firstPresent(row, [
    'name',
    'pairName',
    'pair_name',
    'symbol',
    'poolName',
    'pool_name',
  ]) || row?.pool?.name || row?.pair?.name || shorten(poolAddress));

  return {
    name,
    poolAddress,
    pnlUsd: numberFrom(row, ['pnlUsd', 'pnl_usd', 'totalPnlUsd', 'total_pnl_usd', 'pnl', 'total_pnl']),
    feesUsd: numberFrom(row, ['feesUsd', 'fees_usd', 'totalFeesUsd', 'total_fees_usd', 'feeUsd', 'fee_usd', 'totalFee', 'unclaimedFees']),
    tvlUsd: numberFrom(row, ['tvlUsd', 'tvl_usd', 'liquidityUsd', 'liquidity_usd', 'valueUsd', 'value_usd', 'poolTvl', 'pool_tvl']),
    inRange: !normalizeBoolean(firstPresent(row, ['outOfRange', 'out_of_range', 'isOutOfRange']))
      && !(Array.isArray(row.positionsOutOfRange) && row.positionsOutOfRange.length > 0),
  };
};

const sum = (rows, key) => rows.reduce((total, row) => total + safeFloat(row[key]), 0);

function normalizePortfolio(walletAddress, raw) {
  const rows = choosePositionRows(raw).map(normalizePool);
  const topLevel = raw?.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw;
  const officialTotal = raw?.total && typeof raw.total === 'object' ? raw.total : {};
  const openTotal = raw?.open?.total && typeof raw.open.total === 'object' ? raw.open.total : {};
  const closedTotal = raw?.closed?.total && typeof raw.closed.total === 'object' ? raw.closed.total : {};

  return {
    wallet: walletAddress,
    totalPnlUsd: numberFrom(officialTotal, ['totalPnlUsd', 'total_pnl_usd'])
      || numberFrom(openTotal, ['pnl'])
      || numberFrom(closedTotal, ['pnl'])
      || numberFrom(topLevel, ['totalPnlUsd', 'total_pnl_usd', 'pnlUsd', 'pnl_usd', 'totalPnl', 'total_pnl'])
      || sum(rows, 'pnlUsd'),
    totalPnlSol: numberFrom(officialTotal, ['totalPnlSol', 'total_pnl_sol'])
      || numberFrom(openTotal, ['pnlSol'])
      || numberFrom(closedTotal, ['pnlSol'])
      || numberFrom(topLevel, ['totalPnlSol', 'total_pnl_sol', 'pnlSol', 'pnl_sol']),
    totalFeesUsd: numberFrom(openTotal, ['unclaimedFees'])
      || numberFrom(topLevel, ['totalFeesUsd', 'total_fees_usd', 'feesUsd', 'fees_usd'])
      || sum(rows, 'feesUsd'),
    openPositions: safeInt(firstPresent(raw?.open, ['totalPositions']))
      || safeInt(firstPresent(topLevel, ['openPositions', 'open_positions', 'activePositions', 'active_positions', 'positions', 'totalPositions']))
      || rows.length,
    pools: rows,
  };
}

export function clearWalletPortfolioCache() {
  cache.clear();
}

export async function getWalletPortfolio(walletAddress) {
  if (!isValidAddress(walletAddress)) {
    throw new Error(`Invalid wallet address: ${walletAddress}`);
  }

  const cacheKey = walletAddress.trim();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const raw = await fetchWalletPortfolio(walletAddress);
    const data = normalizePortfolio(walletAddress, raw);
    cache.set(cacheKey, { data, ts: Date.now() });
    return data;
  } catch (error) {
    throw new Error(`Unable to fetch wallet portfolio: ${error instanceof Error ? error.message : String(error)}`);
  }
}
