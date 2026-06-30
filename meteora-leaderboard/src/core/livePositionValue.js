import { createRequire } from 'module';
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config.js';
import { get as cacheGet, set as cacheSet } from '../cache/memCache.js';
import { firstDefined, numberFrom } from '../api/meteoraApi.js';

const require = createRequire(import.meta.url);
const DLMM = require('@meteora-ag/dlmm');
const connection = new Connection(config.solanaRpcUrl, 'confirmed');
const poolInstances = new Map();

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

function tokenDecimals(poolInfo, side) {
  const upper = side.toUpperCase();
  const lower = side.toLowerCase();
  return numberFrom(nestedFirst(poolInfo, [
    `token_${lower}_decimals`,
    `token${upper}Decimals`,
    `token${upper}.decimals`,
    `token_${lower}.decimals`,
  ]), 9);
}

function bnToUiAmount(value, decimals) {
  const raw = value?.toString ? value.toString() : String(value ?? '0');
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric / 10 ** decimals;
}

function amountFrom(data, keys, decimals) {
  for (const key of keys) {
    const value = key.includes('.')
      ? key.split('.').reduce((acc, part) => acc?.[part], data)
      : data?.[key];
    if (value !== undefined && value !== null && value !== '') {
      return bnToUiAmount(value, decimals);
    }
  }
  return 0;
}

function stringAmount(value, decimals) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed / 10 ** decimals : 0;
}

async function getDlmm(poolAddress) {
  const cached = poolInstances.get(poolAddress);
  if (cached) {
    return cached;
  }

  const instance = await DLMM.create(connection, new PublicKey(poolAddress));
  poolInstances.set(poolAddress, instance);
  return instance;
}

export async function getLivePositionState(positionAddress, poolAddress, poolInfo) {
  const cacheKey = `live-position:${positionAddress}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  const dlmm = await getDlmm(poolAddress);
  const position = await dlmm.getPosition(new PublicKey(positionAddress));
  const data = position.positionData;
  const decimalsX = tokenDecimals(poolInfo, 'x');
  const decimalsY = tokenDecimals(poolInfo, 'y');

  const state = {
    totalXAmount: stringAmount(data.totalXAmount, decimalsX),
    totalYAmount: stringAmount(data.totalYAmount, decimalsY),
    unclaimedFeeX: amountFrom(data, [
      'feeX',
      'fee_x',
      'feesX',
      'fees_x',
      'unclaimedFeeX',
      'unclaimed_fee_x',
      'position.feeX',
      'position.unclaimedFeeX',
    ], decimalsX),
    unclaimedFeeY: amountFrom(data, [
      'feeY',
      'fee_y',
      'feesY',
      'fees_y',
      'unclaimedFeeY',
      'unclaimed_fee_y',
      'position.feeY',
      'position.unclaimedFeeY',
    ], decimalsY),
    lowerBinId: data.lowerBinId,
    upperBinId: data.upperBinId,
    owner: data.owner?.toBase58?.(),
    source: 'meteora-dlmm-sdk',
  };

  cacheSet(cacheKey, state, 30_000);
  return state;
}
