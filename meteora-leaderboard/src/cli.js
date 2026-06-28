import 'dotenv/config';
import { config } from './config.js';
import { clear as clearCache } from './cache/memCache.js';
import { isValidAddress } from './api/meteoraApi.js';
import { buildPoolLeaderboard, getMultiPoolLeaderboard } from './core/leaderboard.js';
import { getTopPools, searchPool } from './core/poolScanner.js';
import {
  printBanner,
  printError,
  printHelp,
  printLeaderboard,
  printPools,
  printProgress,
} from './formatters/cliFormatter.js';

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requireValue(arg, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${arg}`);
  }
  return value;
}

function parseArgs(argv) {
  const opts = {
    pool: null,
    pools: null,
    mode: 'winners',
    limit: config.maxPositions,
    topPools: false,
    search: null,
    wallet: null,
    json: false,
    noCache: false,
    help: false,
    verbose: false,
    concurrency: config.concurrency,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--no-cache') {
      opts.noCache = true;
    } else if (arg === '--verbose') {
      opts.verbose = true;
    } else if (arg === '--losers') {
      opts.mode = 'losers';
    } else if (arg === '--mode') {
      opts.mode = requireValue(arg, next).toLowerCase();
      index += 1;
    } else if (arg === '--pool') {
      opts.pool = requireValue(arg, next);
      index += 1;
    } else if (arg === '--pools') {
      opts.pools = requireValue(arg, next).split(',').map((value) => value.trim()).filter(Boolean);
      index += 1;
    } else if (arg === '--limit') {
      opts.limit = parsePositiveInt(requireValue(arg, next), config.maxPositions);
      index += 1;
    } else if (arg === '--top-pools') {
      opts.topPools = true;
    } else if (arg === '--search') {
      opts.search = requireValue(arg, next);
      index += 1;
    } else if (arg === '--wallet') {
      opts.wallet = requireValue(arg, next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['winners', 'losers'].includes(opts.mode)) {
    throw new Error(`Invalid mode: ${opts.mode}`);
  }
  if (opts.pool && !isValidAddress(opts.pool)) {
    throw new Error(`Invalid pool address: ${opts.pool}`);
  }
  if (opts.pools?.some((pool) => !isValidAddress(pool))) {
    throw new Error('One or more pool addresses in --pools are invalid');
  }
  if (opts.wallet && !isValidAddress(opts.wallet)) {
    throw new Error(`Invalid wallet address: ${opts.wallet}`);
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.noCache) {
    clearCache();
  }

  if (opts.search) {
    const pools = await searchPool(opts.search);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(pools, null, 2)}\n`);
    } else {
      printPools(pools);
    }
    return;
  }

  if (opts.topPools) {
    const pools = await getTopPools(opts.limit);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(pools, null, 2)}\n`);
    } else {
      printPools(pools);
    }
    return;
  }

  if (opts.wallet) {
    throw new Error('--wallet is reserved for a future wallet-level view. Use --pool or --pools for leaderboard scans.');
  }

  if (!opts.json) {
    printBanner({
      pool: opts.pool || config.defaultPool,
      pools: opts.pools?.join(','),
      mode: opts.mode,
      limit: opts.limit,
      concurrency: opts.concurrency,
    });
  }

  const result = opts.pools
    ? await getMultiPoolLeaderboard(opts.pools, {
      mode: opts.mode,
      limit: opts.limit,
      concurrency: opts.concurrency,
      noCache: opts.noCache,
      onProgress: opts.json ? null : (done, total) => printProgress(done, total),
    })
    : await buildPoolLeaderboard(opts.pool || config.defaultPool, {
      mode: opts.mode,
      limit: opts.limit,
      concurrency: opts.concurrency,
      noCache: opts.noCache,
      onProgress: opts.json ? null : (done, total) => printProgress(done, total),
    });

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printLeaderboard(result);
  }
}

try {
  await main();
} catch (error) {
  printError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
