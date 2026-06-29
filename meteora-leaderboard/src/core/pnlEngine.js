import {
  getPositionDeposits,
  getPositionFeeClaims,
  getPositionState,
  getPositionWithdraws,
  firstDefined,
  numberFrom,
} from '../api/meteoraApi.js';
import { getSolPrice, SOL_MINT } from '../api/priceApi.js';
import { getLivePositionState } from './livePositionValue.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const PYUSD_MINT = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const STABLE_MINTS = new Set([USDC_MINT, USDT_MINT, PYUSD_MINT]);
const KNOWN_DECIMALS = new Map([
  [SOL_MINT, 9],
  [USDC_MINT, 6],
  [USDT_MINT, 6],
  [PYUSD_MINT, 6],
]);

export function isStablecoin(mintAddress) {
  return STABLE_MINTS.has(String(mintAddress || ''));
}

export function isSolMint(mintAddress) {
  return String(mintAddress || '') === SOL_MINT;
}

function nestedFirst(row, keys) {
  for (const key of keys) {
    if (key.includes('.')) {
      const value = key.split('.').reduce((acc, part) => acc?.[part], row);
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    } else {
      const value = firstDefined(row, [key]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function tokenXMint(poolInfo) {
  return nestedFirst(poolInfo, [
    'token_x_mint',
    'tokenXMint',
    'mint_x',
    'mintX',
    'tokenX.mint',
    'token_x.mint',
    'tokenX.address',
  ]);
}

function tokenYMint(poolInfo) {
  return nestedFirst(poolInfo, [
    'token_y_mint',
    'tokenYMint',
    'mint_y',
    'mintY',
    'tokenY.mint',
    'token_y.mint',
    'tokenY.address',
  ]);
}

function getTokenDecimals(poolInfo, side) {
  const upper = side.toUpperCase();
  const lower = side.toLowerCase();
  const mint = side === 'x' ? tokenXMint(poolInfo) : tokenYMint(poolInfo);
  const known = KNOWN_DECIMALS.get(String(mint || ''));
  if (known !== undefined) return known;
  return numberFrom(nestedFirst(poolInfo, [
    `token_${lower}_decimals`,
    `token${upper}Decimals`,
    `token${upper}.decimals`,
    `token_${lower}.decimals`,
    `mint_${lower}_decimals`,
  ]), 9);
}

function scaleRawAmount(value, decimals) {
  if (!value || value === 0) return 0;
  return value / 10 ** decimals;
}

function looksLikeRawAmount(value, decimals) {
  if (!value || value === 0) return false;
  return value >= 10 ** (decimals + 2);
}

function safeScaleEventAmounts(amounts, poolInfo) {
  const decX = getTokenDecimals(poolInfo, 'x');
  const decY = getTokenDecimals(poolInfo, 'y');
  return {
    x: looksLikeRawAmount(amounts.x, decX) ? scaleRawAmount(amounts.x, decX) : amounts.x,
    y: looksLikeRawAmount(amounts.y, decY) ? scaleRawAmount(amounts.y, decY) : amounts.y,
  };
}

function tokenPoolPrice(poolInfo, side) {
  const upper = side.toUpperCase();
  const lower = side.toLowerCase();
  return numberFrom(nestedFirst(poolInfo, [
    `token_${lower}_price`,
    `token${upper}Price`,
    `token${upper}.price`,
    `token_${lower}.price`,
  ]), 0);
}

function amountFrom(row, keys) {
  return numberFrom(nestedFirst(row, keys), 0);
}

function pricesForEvent(event, poolInfo, currentPrices) {
  const xMint = tokenXMint(poolInfo);
  const yMint = tokenYMint(poolInfo);
  const eventPrice = amountFrom(event, ['price', 'price_per_token', 'token_x_price', 'tokenXPrice']);
  const currentX = currentPrices.get(xMint) || (isStablecoin(xMint) ? 1 : 0);
  const currentY = currentPrices.get(yMint) || (isStablecoin(yMint) ? 1 : 0);

  if (eventPrice > 0 && isStablecoin(yMint)) {
    return { priceX: eventPrice, priceY: 1 };
  }

  if (eventPrice > 0 && isSolMint(yMint)) {
    const solUsd = currentPrices.get(SOL_MINT) || currentY || 150;
    return { priceX: eventPrice * solUsd, priceY: solUsd };
  }

  if (eventPrice > 0 && isStablecoin(xMint)) {
    return { priceX: 1, priceY: 1 / eventPrice };
  }

  return {
    priceX: currentX,
    priceY: currentY,
  };
}

function eventTokenAmounts(event) {
  return {
    x: amountFrom(event, [
      'token_x_amount',
      'tokenXAmount',
      'amountX',
      'amount_x',
      'amountX',
      'x_amount',
      'xAmount',
      'total_x_amount',
    ]),
    y: amountFrom(event, [
      'token_y_amount',
      'tokenYAmount',
      'amountY',
      'amount_y',
      'amountY',
      'y_amount',
      'yAmount',
      'total_y_amount',
    ]),
  };
}

function currentTokenAmounts(state) {
  return {
    x: amountFrom(state, [
      'totalXAmount',
      'total_x_amount',
      'xAmount',
      'x_amount',
      'tokenXAmount',
      'token_x_amount',
      'position.totalXAmount',
    ]),
    y: amountFrom(state, [
      'totalYAmount',
      'total_y_amount',
      'yAmount',
      'y_amount',
      'tokenYAmount',
      'token_y_amount',
      'position.totalYAmount',
    ]),
  };
}

function feeTokenAmounts(row) {
  return {
    x: amountFrom(row, [
      'fee_x_amount',
      'feeXAmount',
      'fees_x_amount',
      'feesXAmount',
      'unclaimedFeeX',
      'unclaimed_fee_x',
      'fee_x',
    ]),
    y: amountFrom(row, [
      'fee_y_amount',
      'feeYAmount',
      'fees_y_amount',
      'feesYAmount',
      'unclaimedFeeY',
      'unclaimed_fee_y',
      'fee_y',
    ]),
  };
}

function usdValue(amounts, priceX, priceY) {
  return (amounts.x * (priceX || 0)) + (amounts.y * (priceY || 0));
}

function eventUsdValue(event, poolInfo, currentPrices) {
  const directUsd = amountFrom(event, ['totalUsd', 'total_usd', 'valueUsd', 'value_usd']);
  if (directUsd > 0) {
    return directUsd;
  }

  const eventPrices = pricesForEvent(event, poolInfo, currentPrices);
  const rawAmounts = eventTokenAmounts(event);
  const amounts = safeScaleEventAmounts(rawAmounts, poolInfo);
  return usdValue(amounts, eventPrices.priceX, eventPrices.priceY);
}

function zeroResult(positionAddress, owner, error = null) {
  return {
    positionAddress,
    owner,
    pnlUsd: 0,
    pnlSol: 0,
    totalDepositedUsd: 0,
    totalWithdrawnUsd: 0,
    currentPositionUsd: 0,
    unclaimedFeesUsd: 0,
    claimedFeesUsd: 0,
    feesEarnedUsd: 0,
    depositCount: 0,
    withdrawCount: 0,
    isActive: false,
    computedAt: Date.now(),
    ...(error ? { error } : {}),
  };
}

export async function computePositionPnl(positionAddress, owner, poolInfo, currentPrices) {
  try {
    const poolAddress = nestedFirst(poolInfo, ['address', 'poolAddress', 'pool_address']);
    const [deposits, withdraws, fallbackPositionState, feeClaims, livePositionState] = await Promise.all([
      getPositionDeposits(positionAddress),
      getPositionWithdraws(positionAddress),
      getPositionState(positionAddress),
      getPositionFeeClaims(positionAddress),
      poolAddress ? getLivePositionState(positionAddress, poolAddress, poolInfo).catch((error) => {
        console.error(`[live] ${positionAddress}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }) : null,
    ]);
    const positionState = livePositionState || fallbackPositionState;

    const xMint = tokenXMint(poolInfo);
    const yMint = tokenYMint(poolInfo);
    const priceX = currentPrices.get(xMint) || tokenPoolPrice(poolInfo, 'x') || (isStablecoin(xMint) ? 1 : 0);
    const priceY = currentPrices.get(yMint) || tokenPoolPrice(poolInfo, 'y') || (isStablecoin(yMint) ? 1 : 0);
    const solPriceUsd = currentPrices.get(SOL_MINT) || await getSolPrice();

    const totalDepositedUsd = deposits.reduce((sum, event) => {
      return sum + eventUsdValue(event, poolInfo, currentPrices);
    }, 0);

    const totalWithdrawnUsd = withdraws.reduce((sum, event) => {
      return sum + eventUsdValue(event, poolInfo, currentPrices);
    }, 0);

    const amounts = safeScaleEventAmounts(currentTokenAmounts(positionState), poolInfo);
    const currentPositionUsd = usdValue(amounts, priceX, priceY);
    const fees = safeScaleEventAmounts(feeTokenAmounts(positionState), poolInfo);
    const unclaimedFeesUsd = usdValue(fees, priceX, priceY);
    const claimedFeesUsd = feeClaims.reduce((sum, event) => {
      return sum + eventUsdValue(event, poolInfo, currentPrices);
    }, 0);
    const feesEarnedUsd = claimedFeesUsd + unclaimedFeesUsd;
    const pnlUsd = totalWithdrawnUsd + currentPositionUsd + feesEarnedUsd - totalDepositedUsd;

    if (Math.abs(pnlUsd) > Math.max(totalDepositedUsd, totalWithdrawnUsd, 1) * 1e6) {
      return zeroResult(positionAddress, owner, `suspect_pnl: pnl=${pnlUsd}`);
    }

    return {
      positionAddress,
      owner,
      pnlUsd,
      pnlSol: solPriceUsd > 0 ? pnlUsd / solPriceUsd : 0,
      pnlWithUnclaimedFeesUsd: pnlUsd,
      pnlWithUnclaimedFeesSol: solPriceUsd > 0 ? pnlUsd / solPriceUsd : 0,
      totalDepositedUsd,
      totalWithdrawnUsd,
      currentPositionUsd,
      unclaimedFeesUsd,
      claimedFeesUsd,
      feesEarnedUsd,
      depositCount: deposits.length,
      withdrawCount: withdraws.length,
      isActive: amounts.x > 0 || amounts.y > 0,
      currentXAmount: amounts.x,
      currentYAmount: amounts.y,
      valuationSource: livePositionState?.source || 'history-only',
      computedAt: Date.now(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pnl] ${positionAddress}: ${message}`);
    return zeroResult(positionAddress, owner, message);
  }
}
