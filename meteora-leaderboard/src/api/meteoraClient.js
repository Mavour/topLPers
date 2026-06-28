import { config } from '../config.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

export const safeFloat = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const safeInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isValidAddress = (value) => typeof value === 'string' && BASE58_RE.test(value.trim());

const firstPresent = (row, keys) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') {
      return row[key];
    }
  }
  return null;
};

const numberFrom = (row, keys) => safeFloat(firstPresent(row, keys));

const intFrom = (row, keys) => {
  const value = firstPresent(row, keys);
  if (Array.isArray(value)) {
    return value.length;
  }
  return safeInt(value);
};

const pickWallet = (row) => {
  const direct = firstPresent(row, [
    'wallet',
    'walletAddress',
    'wallet_address',
    'owner',
    'ownerAddress',
    'owner_address',
    'user',
    'userAddress',
    'user_address',
    'authority',
    'address',
    'account',
  ]);

  if (isValidAddress(direct)) {
    return String(direct).trim();
  }

  const nested = [
    row?.wallet?.address,
    row?.owner?.address,
    row?.user?.address,
    row?.account?.address,
    row?.position?.owner,
    row?.position?.ownerAddress,
  ].find(isValidAddress);

  return nested ? String(nested).trim() : null;
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

  const priorityKeys = [
    'data',
    'positions',
    'leaderboard',
    'rows',
    'items',
    'result',
    'results',
    'users',
    'wallets',
    'portfolio',
    'pnl',
    'position_pnls',
    'positionPnls',
  ];

  const priorityArrays = priorityKeys.flatMap((key) => collectArrays(value[key], depth + 1));
  if (priorityArrays.length > 0) {
    return priorityArrays;
  }

  return Object.values(value).flatMap((child) => collectArrays(child, depth + 1));
};

const chooseRows = (raw) => {
  if (Array.isArray(raw)) {
    return raw;
  }

  const arrays = collectArrays(raw).filter((entry) => entry.some((row) => row && typeof row === 'object'));
  arrays.sort((left, right) => right.length - left.length);
  return arrays[0] || [];
};

export function normalizeRows(raw) {
  return chooseRows(raw)
    .map((row) => {
      if (!row || typeof row !== 'object') {
        return null;
      }

      const wallet = pickWallet(row);
      if (!wallet || wallet === '-') {
        return null;
      }

      const pnlUsd = numberFrom(row, [
        'pnlUsd',
        'pnl_usd',
        'totalPnlUsd',
        'total_pnl_usd',
        'pnl',
        'total_pnl',
        'netPnlUsd',
        'net_pnl_usd',
        'profitUsd',
        'profit_usd',
      ]);
      const pnlSol = numberFrom(row, [
        'pnlSol',
        'pnl_sol',
        'totalPnlSol',
        'total_pnl_sol',
        'profitSol',
        'profit_sol',
        'netPnlSol',
        'net_pnl_sol',
      ]);
      const feesUsd = numberFrom(row, [
        'feesUsd',
        'fees_usd',
        'totalFeesUsd',
        'total_fees_usd',
        'feeUsd',
        'fee_usd',
        'claimedFeesUsd',
        'claimed_fees_usd',
        'fee_earned_usd',
      ]);
      const feesSol = numberFrom(row, [
        'feesSol',
        'fees_sol',
        'totalFeesSol',
        'total_fees_sol',
        'claimedFeesSol',
        'claimed_fees_sol',
        'fee_earned_sol',
      ]);
      const tvlUsd = numberFrom(row, [
        'tvlUsd',
        'tvl_usd',
        'liquidityUsd',
        'liquidity_usd',
        'valueUsd',
        'value_usd',
        'currentValueUsd',
        'current_value_usd',
      ]);
      const positions = intFrom(row, [
        'positions',
        'positionCount',
        'position_count',
        'activePositions',
        'active_positions',
        'totalPositions',
        'total_positions',
      ]) || 1;
      const label = firstPresent(row, ['label', 'name', 'walletLabel', 'wallet_label', 'ownerName']) || null;

      return {
        wallet,
        pnlSol,
        pnlUsd,
        feesUsd,
        feesSol,
        positions,
        tvlUsd,
        label: label ? String(label) : null,
      };
    })
    .filter(Boolean);
}

export async function fetchWithRetry(url, maxAttempts = config.retryAttempts) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
      }

      try {
        return text ? JSON.parse(text) : null;
      } catch (error) {
        throw new Error(`Invalid JSON response: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[meteora] Attempt ${attempt}/${maxAttempts} failed for ${url}: ${message}`);

      if (attempt < maxAttempts) {
        await sleep(config.retryDelayMs * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Meteora request failed after ${maxAttempts} attempts: ${lastError?.message || 'unknown error'}`);
}

const normalizePeriod = (period) => {
  const value = String(period || config.defaultPeriod).trim().toLowerCase();
  if (value === 'all') {
    return 'all';
  }
  if (['7', '30', '90'].includes(value)) {
    return `${value}d`;
  }
  if (['7d', '30d', '90d'].includes(value)) {
    return value;
  }
  return '7d';
};

async function fetchFirstWorking(urls, normalize = true) {
  const errors = [];

  for (const url of urls) {
    try {
      const raw = await fetchWithRetry(url);
      return normalize ? normalizeRows(raw) : raw;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${url} -> ${message}`);
    }
  }

  throw new Error(`All Meteora endpoints failed:\n${errors.join('\n')}`);
}

export async function fetchGlobalLeaderboard(period = config.defaultPeriod, limitHint = config.defaultLimit) {
  const normalizedPeriod = normalizePeriod(period);
  const limit = Math.max(safeInt(limitHint) * 2, 20);
  const urls = [
    `${config.datApiBase}/leaderboard?period=${encodeURIComponent(normalizedPeriod)}&page=0&limit=${limit}`,
    `${config.datApiBase}/portfolio/leaderboard?period=${encodeURIComponent(normalizedPeriod)}&limit=${limit}`,
    `${config.legacyApiBase}/position/leaderboard?period=${encodeURIComponent(normalizedPeriod)}&page=0&limit=${limit}`,
  ];

  return fetchFirstWorking(urls, true);
}

export async function fetchPoolLeaderboard(poolAddress, limitHint = config.defaultLimit) {
  if (!isValidAddress(poolAddress)) {
    throw new Error(`Invalid pool address: ${poolAddress}`);
  }

  const limit = Math.max(safeInt(limitHint) * 2, 20);
  const pool = encodeURIComponent(poolAddress);
  const urls = [
    `${config.datApiBase}/pool/${pool}/positions?page=0&limit=${limit}`,
    `${config.datApiBase}/position/pool_position_pnl/${pool}?page=0&limit=${limit}`,
    `${config.legacyApiBase}/pair/${pool}/positions?page=0&limit=${limit}`,
    `${config.legacyApiBase}/position/pool_position_pnl/${pool}?page=0&limit=${limit}`,
  ];

  return fetchFirstWorking(urls, true);
}

export async function fetchWalletPortfolio(walletAddress) {
  if (!isValidAddress(walletAddress)) {
    throw new Error(`Invalid wallet address: ${walletAddress}`);
  }

  const wallet = encodeURIComponent(walletAddress);
  const officialRequests = [
    ['open', `${config.datApiBase}/portfolio/open?user=${wallet}&page=1&page_size=50`],
    ['closed', `${config.datApiBase}/portfolio?user=${wallet}&page=1&page_size=50`],
    ['total', `${config.datApiBase}/portfolio/total?user=${wallet}`],
  ];
  const officialResults = await Promise.allSettled(
    officialRequests.map(async ([key, url]) => [key, await fetchWithRetry(url)]),
  );
  const official = officialResults.reduce((acc, result, index) => {
    const [key, url] = officialRequests[index];
    if (result.status === 'fulfilled') {
      acc[key] = result.value[1];
    } else {
      console.error(`[meteora] Official wallet endpoint failed for ${url}: ${result.reason?.message || result.reason}`);
    }
    return acc;
  }, {});

  if (Object.keys(official).length > 0) {
    return {
      source: 'official',
      ...official,
      pools: [
        ...(official.open?.pools || []),
        ...(official.closed?.pools || []),
      ],
    };
  }

  const urls = [
    `${config.datApiBase}/portfolio/${wallet}`,
    `${config.datApiBase}/user/${wallet}/portfolio`,
    `${config.legacyApiBase}/position/user_positions/${wallet}`,
  ];

  return fetchFirstWorking(urls, false);
}
