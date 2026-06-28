import { config } from './config.js';
import { getSolPrice } from './api/jupiterPrice.js';
import { isValidAddress } from './api/meteoraClient.js';
import { getLeaderboard } from './core/leaderboard.js';
import { getWalletPortfolio } from './core/walletPortfolio.js';
import { printLeaderboard, printWalletPortfolio } from './formatters/cliFormatter.js';

const red = (value) => `\x1b[31m${value}\x1b[0m`;

function printHelp() {
  process.stdout.write(`Meteora DLMM LP Leaderboard v1.0.0

Usage:
  node src/cli.js [options]

Options:
  --mode <winners|losers>   Leaderboard mode
  --winners                 Shortcut for --mode winners
  --losers                  Shortcut for --mode losers
  --pool <address>          Query a specific Meteora DLMM pool
  --wallet <address>        Query a wallet portfolio
  --period <7|30|90|all>    Leaderboard period
  --limit <number>          Max rows to show
  --json                    Output machine-readable JSON
  --help                    Show this help

Examples:
  node src/cli.js
  node src/cli.js --losers --period 30 --limit 10
  node src/cli.js --pool ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq
  node src/cli.js --wallet 11111111111111111111111111111111 --json
`);
}

function parseArgs(argv) {
  const opts = {
    mode: 'winners',
    pool: null,
    wallet: null,
    period: config.defaultPeriod,
    limit: config.defaultLimit,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--winners') {
      opts.mode = 'winners';
    } else if (arg === '--losers') {
      opts.mode = 'losers';
    } else if (arg === '--mode') {
      opts.mode = String(next || '').toLowerCase() === 'losers' ? 'losers' : 'winners';
      index += 1;
    } else if (arg === '--pool') {
      opts.pool = next || null;
      index += 1;
    } else if (arg === '--wallet') {
      opts.wallet = next || null;
      index += 1;
    } else if (arg === '--period') {
      opts.period = next || config.defaultPeriod;
      index += 1;
    } else if (arg === '--limit') {
      const parsed = Number.parseInt(next, 10);
      opts.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : config.defaultLimit;
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
  if (opts.wallet && !isValidAddress(opts.wallet)) {
    throw new Error(`Invalid wallet address: ${opts.wallet}`);
  }

  return opts;
}

function startSpinner(enabled) {
  if (!enabled) {
    return () => {};
  }

  const frames = ['.', '..', '...'];
  let index = 0;
  process.stderr.write('Fetching data');
  const timer = setInterval(() => {
    process.stderr.write(`\rFetching data${frames[index % frames.length]}   `);
    index += 1;
  }, 350);

  return () => {
    clearInterval(timer);
    process.stderr.write('\rFetching data... done\n\n');
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }

  if (!opts.json) {
    process.stderr.write('Meteora DLMM LP Leaderboard v1.0.0\n');
  }

  const stopSpinner = startSpinner(!opts.json);

  try {
    if (opts.wallet) {
      const [solPrice, portfolio] = await Promise.all([
        getSolPrice(),
        getWalletPortfolio(opts.wallet),
      ]);
      stopSpinner();

      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ type: 'wallet', solPrice, data: portfolio }, null, 2)}\n`);
      } else {
        printWalletPortfolio(portfolio, solPrice);
      }
      return;
    }

    const [solPrice, rows] = await Promise.all([
      getSolPrice(),
      getLeaderboard({
        pool: opts.pool,
        period: opts.period,
        limit: opts.limit,
        mode: opts.mode,
      }),
    ]);
    stopSpinner();

    if (opts.json) {
      process.stdout.write(`${JSON.stringify({
        type: 'leaderboard',
        mode: opts.mode,
        period: opts.period,
        pool: opts.pool,
        limit: opts.limit,
        solPrice,
        data: rows,
      }, null, 2)}\n`);
    } else {
      printLeaderboard(rows, opts, solPrice);
    }
  } catch (error) {
    stopSpinner();
    throw error;
  }
}

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`${red(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`)}\n`);
  process.exitCode = 1;
});

process.on('uncaughtException', (error) => {
  process.stderr.write(`${red(`Uncaught exception: ${error.message}`)}\n`);
  process.exitCode = 1;
});

try {
  await main();
} catch (error) {
  process.stderr.write(`${red(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
}
