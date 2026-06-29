function number(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function scaleRawAmount(value, decimals) {
  if (!value || value === 0) return 0;
  return value / 10 ** decimals;
}

function looksLikeRawAmount(value, decimals) {
  if (!value || value === 0) return false;
  return value >= 10 ** (decimals + 2);
}

function tokenDecimals(row, side) {
  const upper = side.toUpperCase();
  const lower = side.toLowerCase();
  return number(firstDefined(row, [
    `token_${lower}_decimals`,
    `token${upper}Decimals`,
    `token${upper}.decimals`,
    `token_${lower}.decimals`,
    `mint_${lower}_decimals`,
  ]), side === 'x' ? 9 : 6);
}

function safeScaleEventAmounts(amounts, poolInfo) {
  const decX = tokenDecimals(poolInfo, 'x');
  const decY = tokenDecimals(poolInfo, 'y');
  return {
    x: looksLikeRawAmount(amounts.x, decX) ? scaleRawAmount(amounts.x, decX) : amounts.x,
    y: looksLikeRawAmount(amounts.y, decY) ? scaleRawAmount(amounts.y, decY) : amounts.y,
  };
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

export function normalizeClosedPosition(pos, solPriceUsd = 150) {
  const rawPnlUsd = number(pos.pnl ?? pos.pnl_usd ?? pos.net_pnl);
  const feesUsd = sumUsd(pos, ['total_claimed_fees', 'fees_usd', 'total_fees_usd']);
  const depositedUsd = sumUsd(pos, ['total_deposits', 'deposited_usd']);
  const withdrawnUsd = sumUsd(pos, ['total_withdraws', 'withdrawn_usd']);
  const pnlUsd = suspectPnl(rawPnlUsd, depositedUsd, withdrawnUsd) ? 0 : rawPnlUsd;

  return {
    positionAddress: pos.position_address || pos.address || '',
    poolAddress: pos.pool_address || pos.pair_address || '',
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
  const rawPnlUsd = number(pos.pnl ?? pos.pnl_usd ?? pos.unrealized_pnl ?? pos.net_pnl);
  const feesUsd = number(pos.unclaimed_fees_usd)
    || number(pos.unclaimed_fee_x_usd) + number(pos.unclaimed_fee_y_usd)
    || number(pos.fees_usd);
  const currentValueUsd = number(pos.current_value_usd ?? pos.position_value_usd ?? pos.value_usd);
  const pnlUsd = suspectPnl(rawPnlUsd, currentValueUsd, 0) ? 0 : rawPnlUsd;

  return {
    positionAddress: pos.position_address || pos.address || '',
    poolAddress: pos.pool_address || pos.pair_address || pos.lb_pair || '',
    pnlUsd,
    pnlSol: solPriceUsd > 0 ? pnlUsd / solPriceUsd : 0,
    feesUsd,
    depositedUsd: number(pos.deposited_usd),
    withdrawnUsd: number(pos.withdrawn_usd),
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
        poolName: key,
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
