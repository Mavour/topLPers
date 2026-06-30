function number(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function scaleRawAmount(value, decimals) {
  if (!value || value === 0) return 0;
  return value / 10 ** decimals;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const STABLE_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
]);
const KNOWN_DECIMALS = new Map([
  [SOL_MINT, 9],
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6],
  ['2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', 6],
]);

function looksLikeRawAmount(value, decimals) {
  if (!value || value === 0) return false;
  return value >= 10 ** (decimals + 2);
}

function tokenMint(row, side) {
  const upper = side.toUpperCase();
  const lower = side.toLowerCase();
  return firstDefined(row, [
    `token_${lower}_mint`,
    `token${upper}Mint`,
    `mint_${lower}`,
    `mint${upper}`,
    `token${upper}.mint`,
    `token_${lower}.mint`,
    `token${upper}.address`,
    `token_${lower}.address`,
    `mint_${lower}_address`,
  ]);
}

function tokenDecimals(row, side) {
  const known = KNOWN_DECIMALS.get(String(tokenMint(row, side) || ''));
  if (known !== undefined) return known;

  const upper = side.toUpperCase();
  const lower = side.toLowerCase();
  return number(firstDefined(row, [
    `token_${lower}_decimals`,
    `token${upper}Decimals`,
    `token${upper}.decimals`,
    `token_${lower}.decimals`,
    `mint_${lower}_decimals`,
  ]), 9);
}

function safeScaleEventAmounts(amounts, poolInfo) {
  const decX = tokenDecimals(poolInfo, 'x');
  const decY = tokenDecimals(poolInfo, 'y');
  return {
    x: looksLikeRawAmount(amounts.x, decX) ? scaleRawAmount(amounts.x, decX) : amounts.x,
    y: looksLikeRawAmount(amounts.y, decY) ? scaleRawAmount(amounts.y, decY) : amounts.y,
  };
}

function tokenPrice(row, side, solPriceUsd) {
  const upper = side.toUpperCase();
  const lower = side.toLowerCase();
  const mint = tokenMint(row, side);
  const explicit = number(firstDefined(row, [
    `token_${lower}_price`,
    `token${upper}Price`,
    `token${upper}.price`,
    `token_${lower}.price`,
    `${lower}_price`,
  ]), NaN);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (mint === SOL_MINT) return solPriceUsd;
  if (STABLE_MINTS.has(String(mint || ''))) return 1;
  return 0;
}

function usdValue(amounts, poolInfo, solPriceUsd) {
  return (amounts.x * tokenPrice(poolInfo, 'x', solPriceUsd))
    + (amounts.y * tokenPrice(poolInfo, 'y', solPriceUsd));
}

function amountPair(row, xKeys, yKeys) {
  return {
    x: number(firstDefined(row, xKeys)),
    y: number(firstDefined(row, yKeys)),
  };
}

function usdFromObject(row, poolInfo, solPriceUsd) {
  if (!row || typeof row !== 'object') return 0;
  const direct = number(firstDefined(row, ['totalUsd', 'total_usd', 'valueUsd', 'value_usd']), NaN);
  if (Number.isFinite(direct) && direct !== 0) return direct;

  const xUsd = number(firstDefined(row, ['amountXUsd', 'amount_x_usd', 'tokenXUsd', 'token_x_usd']), 0);
  const yUsd = number(firstDefined(row, ['amountYUsd', 'amount_y_usd', 'tokenYUsd', 'token_y_usd']), 0);
  if (xUsd || yUsd) return xUsd + yUsd;

  const amounts = safeScaleEventAmounts(amountPair(row, [
    'amountX',
    'amount_x',
    'tokenXAmount',
    'token_x_amount',
    'xAmount',
    'x_amount',
    'totalXAmount',
    'total_x_amount',
  ], [
    'amountY',
    'amount_y',
    'tokenYAmount',
    'token_y_amount',
    'yAmount',
    'y_amount',
    'totalYAmount',
    'total_y_amount',
  ]), poolInfo);
  return usdValue(amounts, poolInfo, solPriceUsd);
}

function usdFromSources(row, poolInfo, solPriceUsd, directKeys, xKeys = [], yKeys = []) {
  for (const key of directKeys) {
    const value = firstDefined(row, [key]);
    if (value && typeof value === 'object') return usdFromObject(value, poolInfo, solPriceUsd);
    const parsed = number(value, NaN);
    if (Number.isFinite(parsed) && parsed !== 0) return parsed;
  }

  const rawAmounts = amountPair(row, xKeys, yKeys);
  if (!rawAmounts.x && !rawAmounts.y) return 0;
  return usdValue(safeScaleEventAmounts(rawAmounts, poolInfo), poolInfo, solPriceUsd);
}

function suspectPnl(pnlUsd, depositedUsd, withdrawnUsd) {
  return Math.abs(pnlUsd) > Math.max(depositedUsd, withdrawnUsd, 1) * 1e6;
}

function sumUsd(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value && typeof value === 'object') {
      return number(value.amount_x_usd) + number(value.amount_y_usd);
    }
    const parsed = number(value, NaN);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

const TOTAL_FEE_USD_KEYS = [
  'fees_earned_usd',
  'feesEarnedUsd',
  'total_fees_usd',
  'totalFeesUsd',
  'total_fee_usd',
  'totalFeeUsd',
];

const CLAIMED_FEE_USD_KEYS = [
  'claim_fee_usd',
  'claimFeeUsd',
  'claimed_fees_usd',
  'claimedFeesUsd',
  'total_claimed_fees',
  'totalClaimedFees',
  'total_claimed_fees_usd',
  'fees_usd',
];

const UNCLAIMED_FEE_USD_KEYS = [
  'unclaimed_fees_usd',
  'unclaimedFeesUsd',
  'unclaimed_fee_usd',
  'unclaimedFeeUsd',
];

const CLAIMED_FEE_X_KEYS = [
  'claim_fee_x_amount',
  'claimFeeXAmount',
  'claimed_fee_x_amount',
  'claimedFeeXAmount',
  'claimed_fees_x_amount',
  'claimedFeesXAmount',
  'total_claimed_fee_x_amount',
  'fee_x_amount',
  'feeXAmount',
  'fees_x_amount',
  'feesXAmount',
  'fee_x',
];

const CLAIMED_FEE_Y_KEYS = [
  'claim_fee_y_amount',
  'claimFeeYAmount',
  'claimed_fee_y_amount',
  'claimedFeeYAmount',
  'claimed_fees_y_amount',
  'claimedFeesYAmount',
  'total_claimed_fee_y_amount',
  'fee_y_amount',
  'feeYAmount',
  'fees_y_amount',
  'feesYAmount',
  'fee_y',
];

const UNCLAIMED_FEE_X_KEYS = [
  'unclaimed_fee_x',
  'unclaimedFeeX',
  'unclaimed_fee_x_amount',
  'unclaimedFeeXAmount',
  'unclaimed_fees_x_amount',
  'unclaimedFeesXAmount',
];

const UNCLAIMED_FEE_Y_KEYS = [
  'unclaimed_fee_y',
  'unclaimedFeeY',
  'unclaimed_fee_y_amount',
  'unclaimedFeeYAmount',
  'unclaimed_fees_y_amount',
  'unclaimedFeesYAmount',
];

function positionFeesUsd(pos, poolInfo, solPriceUsd, { includeUnclaimed = false } = {}) {
  const total = usdFromSources(pos, poolInfo, solPriceUsd, TOTAL_FEE_USD_KEYS);
  const claimed = usdFromSources(pos, poolInfo, solPriceUsd, CLAIMED_FEE_USD_KEYS, CLAIMED_FEE_X_KEYS, CLAIMED_FEE_Y_KEYS);
  const unclaimed = includeUnclaimed
    ? usdFromSources(pos, poolInfo, solPriceUsd, UNCLAIMED_FEE_USD_KEYS, UNCLAIMED_FEE_X_KEYS, UNCLAIMED_FEE_Y_KEYS)
    : 0;
  return Math.max(total, claimed + unclaimed);
}

function firstDefined(row, keys) {
  for (const key of keys) {
    if (key.includes('.')) {
      const value = key.split('.').reduce((acc, part) => acc?.[part], row);
      if (value !== undefined && value !== null && value !== '') return value;
    } else if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') {
      return row[key];
    }
  }
  return null;
}

function binRange(pos) {
  const lower = binId(pos, ['lower_bin_id', 'lowerBinId', 'bin_lower', 'min_bin_id']);
  const upper = binId(pos, ['upper_bin_id', 'upperBinId', 'bin_upper', 'max_bin_id']);
  return lower !== null && upper !== null ? `${lower} to ${upper}` : null;
}

function binId(pos, keys) {
  const value = firstDefined(pos, keys);
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function durationSeconds(start, end) {
  const created = number(start);
  const closed = number(end);
  return created > 0 && closed > created ? closed - created : null;
}

function poolName(pos) {
  return firstDefined(pos, [
    'pool_name',
    'poolName',
    'pair_name',
    'pool.name',
    'pool_info.name',
  ]);
}

export function normalizeClosedPosition(pos, solPriceUsd = 150) {
  const poolInfo = pos.pool || pos.pool_info || pos;
  const feesUsd = positionFeesUsd(pos, poolInfo, solPriceUsd)
    || sumUsd(pos, [...TOTAL_FEE_USD_KEYS, ...CLAIMED_FEE_USD_KEYS]);
  const depositedUsd = usdFromSources(pos, poolInfo, solPriceUsd, [
    'total_deposits',
    'deposited_usd',
  ], [
    'deposit_x_amount',
    'depositXAmount',
    'deposited_x_amount',
    'depositedXAmount',
  ], [
    'deposit_y_amount',
    'depositYAmount',
    'deposited_y_amount',
    'depositedYAmount',
  ]) || sumUsd(pos, ['total_deposits', 'deposited_usd']);
  const withdrawnUsd = usdFromSources(pos, poolInfo, solPriceUsd, [
    'total_withdraws',
    'withdrawn_usd',
  ], [
    'withdraw_x_amount',
    'withdrawXAmount',
    'withdrawn_x_amount',
    'withdrawnXAmount',
  ], [
    'withdraw_y_amount',
    'withdrawYAmount',
    'withdrawn_y_amount',
    'withdrawnYAmount',
  ]) || sumUsd(pos, ['total_withdraws', 'withdrawn_usd']);
  const rawPnlUsd = number(pos.pnl ?? pos.pnl_usd ?? pos.net_pnl, NaN);
  const computedPnlUsd = withdrawnUsd + feesUsd - depositedUsd;
  const basePnlUsd = Number.isFinite(rawPnlUsd) ? rawPnlUsd : computedPnlUsd;
  const pnlUsd = suspectPnl(basePnlUsd, depositedUsd, withdrawnUsd) ? computedPnlUsd : basePnlUsd;

  return {
    positionAddress: pos.position_address || pos.address || '',
    poolAddress: pos.pool_address || pos.pair_address || '',
    poolName: poolName(pos),
    pnlUsd,
    pnlSol: solPriceUsd > 0 ? pnlUsd / solPriceUsd : 0,
    feesUsd,
    depositedUsd,
    withdrawnUsd,
    closedAt: pos.closed_at || null,
    createdAt: pos.created_at || null,
    durationSeconds: durationSeconds(pos.created_at, pos.closed_at),
    binRange: binRange(pos),
    lowerBinId: binId(pos, ['lower_bin_id', 'lowerBinId', 'bin_lower', 'min_bin_id']),
    upperBinId: binId(pos, ['upper_bin_id', 'upperBinId', 'bin_upper', 'max_bin_id']),
    currentValueUsd: 0,
    isActive: false,
  };
}

export function normalizeOpenPosition(pos, solPriceUsd = 150) {
  const poolInfo = pos.pool || pos.pool_info || pos;
  const feesUsd = positionFeesUsd(pos, poolInfo, solPriceUsd, { includeUnclaimed: true })
    || number(pos.unclaimed_fee_x_usd) + number(pos.unclaimed_fee_y_usd);
  const currentValueUsd = usdFromSources(pos, poolInfo, solPriceUsd, [
    'current_value_usd',
    'position_value_usd',
    'value_usd',
  ], [
    'totalXAmount',
    'total_x_amount',
    'xAmount',
    'x_amount',
    'tokenXAmount',
    'token_x_amount',
    'position.totalXAmount',
  ], [
    'totalYAmount',
    'total_y_amount',
    'yAmount',
    'y_amount',
    'tokenYAmount',
    'token_y_amount',
    'position.totalYAmount',
  ]);
  const depositedUsd = usdFromSources(pos, poolInfo, solPriceUsd, [
    'deposited_usd',
    'total_deposits',
  ]);
  const withdrawnUsd = usdFromSources(pos, poolInfo, solPriceUsd, [
    'withdrawn_usd',
    'total_withdraws',
  ]);
  const rawPnlUsd = number(pos.pnl ?? pos.pnl_usd ?? pos.unrealized_pnl ?? pos.net_pnl, NaN);
  const computedPnlUsd = currentValueUsd + withdrawnUsd + feesUsd - depositedUsd;
  const hasLiveCurrentValue = currentValueUsd > 0;
  const rawLooksLikeMissingOpenValue = !hasLiveCurrentValue
    && depositedUsd > 0
    && Number.isFinite(rawPnlUsd)
    && rawPnlUsd <= -depositedUsd * 0.5;
  const computedLooksLikeMissingOpenValue = !hasLiveCurrentValue
    && depositedUsd > 0
    && computedPnlUsd <= -depositedUsd * 0.5;
  const basePnlUsd = Number.isFinite(rawPnlUsd) && !rawLooksLikeMissingOpenValue
    ? rawPnlUsd
    : computedLooksLikeMissingOpenValue
      ? feesUsd
      : computedPnlUsd;
  const fallbackPnlUsd = computedLooksLikeMissingOpenValue ? feesUsd : computedPnlUsd;
  const pnlUsd = suspectPnl(basePnlUsd, Math.max(currentValueUsd, depositedUsd), withdrawnUsd) ? fallbackPnlUsd : basePnlUsd;

  return {
    positionAddress: pos.position_address || pos.address || '',
    poolAddress: pos.pool_address || pos.pair_address || pos.lb_pair || '',
    poolName: poolName(pos),
    pnlUsd,
    pnlSol: solPriceUsd > 0 ? pnlUsd / solPriceUsd : 0,
    feesUsd,
    depositedUsd,
    withdrawnUsd,
    closedAt: null,
    createdAt: pos.created_at || null,
    durationSeconds: null,
    binRange: binRange(pos),
    lowerBinId: binId(pos, ['lower_bin_id', 'lowerBinId', 'bin_lower', 'min_bin_id']),
    upperBinId: binId(pos, ['upper_bin_id', 'upperBinId', 'bin_upper', 'max_bin_id']),
    currentValueUsd,
    isActive: true,
  };
}

export function aggregateWalletPnl(wallet, closedPositions, openPositions) {
  const allPositions = [...closedPositions, ...openPositions];
  if (!allPositions.length) {
    return {
      wallet,
      pnlUsd: 0,
      pnlSol: 0,
      feesEarnedUsd: 0,
      depositedUsd: 0,
      withdrawnUsd: 0,
      positionCount: 0,
      poolCount: 0,
      poolBreakdown: [],
    };
  }

  const byPool = new Map();
  for (const pos of allPositions) {
    const key = pos.poolAddress || 'unknown';
    if (!byPool.has(key)) {
      byPool.set(key, {
        poolAddress: key,
        poolName: pos.poolName || key,
        pnlUsd: 0,
        pnlSol: 0,
        feesUsd: 0,
        depositedUsd: 0,
        withdrawnUsd: 0,
        positionCount: 0,
        openPositions: [],
        closedPositions: [],
      });
    }
    const entry = byPool.get(key);
    if (pos.poolName && entry.poolName === key) entry.poolName = pos.poolName;
    entry.pnlUsd += pos.pnlUsd;
    entry.pnlSol += pos.pnlSol;
    entry.feesUsd += pos.feesUsd;
    entry.depositedUsd += pos.depositedUsd;
    entry.withdrawnUsd += pos.withdrawnUsd;
    entry.positionCount += 1;
    if (pos.isActive) entry.openPositions.push(pos);
    else entry.closedPositions.push(pos);
  }

  return {
    wallet,
    pnlUsd: allPositions.reduce((sum, pos) => sum + pos.pnlUsd, 0),
    pnlSol: allPositions.reduce((sum, pos) => sum + pos.pnlSol, 0),
    feesEarnedUsd: allPositions.reduce((sum, pos) => sum + pos.feesUsd, 0),
    depositedUsd: closedPositions.reduce((sum, pos) => sum + pos.depositedUsd, 0),
    withdrawnUsd: closedPositions.reduce((sum, pos) => sum + pos.withdrawnUsd, 0),
    positionCount: allPositions.length,
    poolCount: byPool.size,
    poolBreakdown: Array.from(byPool.values()).sort((left, right) => right.pnlUsd - left.pnlUsd),
  };
}
