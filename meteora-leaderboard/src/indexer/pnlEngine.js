import {
  firstDefined,
  getTokenDecimals,
  getPositionDeposits,
  getPositionFeeClaims,
  getPositionState,
  getPositionWithdraws,
  numberFrom,
  tokenMint as poolTokenMint,
} from '../api/meteora.js';
import { getSolPrice, isStablecoin, SOL_MINT } from '../api/price.js';

function nestedFirst(row, keys) {
  return firstDefined(row, keys);
}

export function poolAddress(pool) {
  return nestedFirst(pool, ['address', 'pubkey', 'pair_address', 'pool_address']);
}

export function tokenMint(pool, side) {
  return poolTokenMint(pool, side);
}

export function tokenSymbol(pool, side) {
  const upper = side.toUpperCase();
  const lower = side.toLowerCase();
  return nestedFirst(pool, [
    `token_${lower}_symbol`,
    `token${upper}Symbol`,
    `token${upper}.symbol`,
    `token_${lower}.symbol`,
  ]);
}

function tokenDecimals(pool, side) {
  return getTokenDecimals(pool, side);
}

export function poolName(pool) {
  const explicit = nestedFirst(pool, ['name', 'pool_name', 'symbol']);
  if (explicit) return String(explicit);
  return `${tokenSymbol(pool, 'x') || 'X'}/${tokenSymbol(pool, 'y') || 'Y'}`;
}

export function poolMetric(pool, keys) {
  return numberFrom(nestedFirst(pool, keys), 0);
}

function amountFrom(row, keys) {
  return numberFrom(nestedFirst(row, keys), 0);
}

function scaleRawAmount(value, decimals) {
  return value / 10 ** decimals;
}

function looksLikeRawAmount(value, mint) {
  if (!Number.isFinite(value) || value <= 0) return false;
  if (mint === SOL_MINT) return value >= 1e11;
  if (isStablecoin(mint)) return value >= 1e8;
  return value >= 1e9;
}

function safeScaleAmount(value, mint, decimals) {
  return looksLikeRawAmount(value, mint) ? scaleRawAmount(value, decimals) : value;
}

function safeScaleEventAmounts(amounts, poolInfo) {
  const xMint = tokenMint(poolInfo, 'x');
  const yMint = tokenMint(poolInfo, 'y');
  return {
    x: safeScaleAmount(amounts.x, xMint, tokenDecimals(poolInfo, 'x')),
    y: safeScaleAmount(amounts.y, yMint, tokenDecimals(poolInfo, 'y')),
  };
}

function eventTokenAmounts(event) {
  return {
    x: amountFrom(event, ['token_x_amount', 'tokenXAmount', 'amountX', 'amount_x', 'xAmount', 'total_x_amount']),
    y: amountFrom(event, ['token_y_amount', 'tokenYAmount', 'amountY', 'amount_y', 'yAmount', 'total_y_amount']),
  };
}

function normalizeAmountsForState(amounts, state, poolInfo) {
  if (!state?.amountsAreRaw) return amounts;
  return {
    x: scaleRawAmount(amounts.x, tokenDecimals(poolInfo, 'x')),
    y: scaleRawAmount(amounts.y, tokenDecimals(poolInfo, 'y')),
  };
}

function currentTokenAmounts(state, poolInfo) {
  const amounts = {
    x: amountFrom(state, ['totalXAmount', 'total_x_amount', 'xAmount', 'x_amount', 'tokenXAmount', 'token_x_amount', 'position.totalXAmount']),
    y: amountFrom(state, ['totalYAmount', 'total_y_amount', 'yAmount', 'y_amount', 'tokenYAmount', 'token_y_amount', 'position.totalYAmount']),
  };
  return normalizeAmountsForState(amounts, state, poolInfo);
}

function feeTokenAmounts(row, poolInfo = null) {
  const amounts = {
    x: amountFrom(row, ['fee_x_amount', 'feeXAmount', 'fees_x_amount', 'feesXAmount', 'unclaimedFeeX', 'unclaimed_fee_x', 'fee_x']),
    y: amountFrom(row, ['fee_y_amount', 'feeYAmount', 'fees_y_amount', 'feesYAmount', 'unclaimedFeeY', 'unclaimed_fee_y', 'fee_y']),
  };
  return poolInfo ? normalizeAmountsForState(amounts, row, poolInfo) : amounts;
}

function usdValue(amounts, priceX, priceY) {
  return (amounts.x * (priceX || 0)) + (amounts.y * (priceY || 0));
}

function pricesForEvent(event, poolInfo, currentPrices, solPrice) {
  const xMint = tokenMint(poolInfo, 'x');
  const yMint = tokenMint(poolInfo, 'y');
  const eventPrice = amountFrom(event, ['price', 'price_per_token', 'token_x_price', 'tokenXPrice']);
  const currentX = currentPrices.get(xMint) || (isStablecoin(xMint) ? 1 : 0);
  const currentY = currentPrices.get(yMint) || (isStablecoin(yMint) ? 1 : 0);

  if (eventPrice > 0 && isStablecoin(yMint)) return { priceX: eventPrice, priceY: 1 };
  if (eventPrice > 0 && yMint === SOL_MINT) return { priceX: eventPrice * solPrice, priceY: solPrice };
  if (eventPrice > 0 && isStablecoin(xMint)) return { priceX: 1, priceY: 1 / eventPrice };
  return { priceX: currentX, priceY: currentY };
}

function eventUsdValue(event, poolInfo, currentPrices, solPrice) {
  const directUsd = amountFrom(event, ['totalUsd', 'total_usd', 'valueUsd', 'value_usd']);
  if (directUsd > 0) return directUsd;
  const prices = pricesForEvent(event, poolInfo, currentPrices, solPrice);
  return usdValue(safeScaleEventAmounts(eventTokenAmounts(event), poolInfo), prices.priceX, prices.priceY);
}

function zeroResult(positionAddress, error = null) {
  return {
    positionAddress,
    pnlUsd: 0,
    pnlSol: 0,
    depositedUsd: 0,
    withdrawnUsd: 0,
    currentUsd: 0,
    unclaimedUsd: 0,
    feesEarnedUsd: 0,
    depositCount: 0,
    withdrawCount: 0,
    isActive: false,
    error,
  };
}

function isPnlSuspect({ pnlUsd, depositedUsd, withdrawnUsd }) {
  const base = Math.max(Math.abs(depositedUsd || 0), Math.abs(withdrawnUsd || 0), 1);
  return Math.abs(pnlUsd || 0) > base * 1_000_000;
}

export async function computePositionPnl(positionAddress, poolInfo, currentPrices) {
  try {
    const [deposits, withdraws, positionState, feeClaims, solPrice] = await Promise.all([
      getPositionDeposits(positionAddress),
      getPositionWithdraws(positionAddress),
      getPositionState(positionAddress),
      getPositionFeeClaims(positionAddress),
      getSolPrice(),
    ]);
    const xMint = tokenMint(poolInfo, 'x');
    const yMint = tokenMint(poolInfo, 'y');
    const priceX = currentPrices.get(xMint) || (isStablecoin(xMint) ? 1 : 0);
    const priceY = currentPrices.get(yMint) || (isStablecoin(yMint) ? 1 : 0);

    const depositedUsd = deposits.reduce((sum, event) => sum + eventUsdValue(event, poolInfo, currentPrices, solPrice), 0);
    const withdrawnUsd = withdraws.reduce((sum, event) => sum + eventUsdValue(event, poolInfo, currentPrices, solPrice), 0);
    const currentAmounts = currentTokenAmounts(positionState, poolInfo);
    const currentUsd = usdValue(currentAmounts, priceX, priceY);
    const unclaimedUsd = positionState.feesAreVerified === false ? 0 : usdValue(feeTokenAmounts(positionState, poolInfo), priceX, priceY);
    const claimedFeesUsd = feeClaims.reduce((sum, event) => sum + eventUsdValue(event, poolInfo, currentPrices, solPrice), 0)
      + withdraws.reduce((sum, event) => sum + usdValue(safeScaleEventAmounts(feeTokenAmounts(event), poolInfo), priceX, priceY), 0);
    const feesEarnedUsd = claimedFeesUsd + unclaimedUsd;
    const pnlUsd = withdrawnUsd + currentUsd + feesEarnedUsd - depositedUsd;

    if (isPnlSuspect({ pnlUsd, depositedUsd, withdrawnUsd })) {
      return zeroResult(positionAddress, `suspect PnL rejected: ${pnlUsd}`);
    }

    return {
      positionAddress,
      pnlUsd,
      pnlSol: solPrice > 0 ? pnlUsd / solPrice : 0,
      depositedUsd,
      withdrawnUsd,
      currentUsd,
      unclaimedUsd,
      feesEarnedUsd,
      depositCount: deposits.length,
      withdrawCount: withdraws.length,
      isActive: currentUsd > 0.01,
      error: null,
    };
  } catch (error) {
    return zeroResult(positionAddress, error instanceof Error ? error.message : String(error));
  }
}

export function aggregateByWallet(positionResults, positionOwnerMap) {
  const wallets = new Map();
  for (const result of positionResults) {
    const wallet = positionOwnerMap.get(result.positionAddress);
    if (!wallet) continue;
    const existing = wallets.get(wallet) || {
      pnlUsd: 0,
      pnlSol: 0,
      feesEarnedUsd: 0,
      depositedUsd: 0,
      withdrawnUsd: 0,
      positionCount: 0,
    };
    existing.pnlUsd += result.pnlUsd || 0;
    existing.pnlSol += result.pnlSol || 0;
    existing.feesEarnedUsd += result.feesEarnedUsd || 0;
    existing.depositedUsd += result.depositedUsd || 0;
    existing.withdrawnUsd += result.withdrawnUsd || 0;
    existing.positionCount += 1;
    wallets.set(wallet, existing);
  }
  return wallets;
}
