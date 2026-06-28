const ANSI_RE = /\x1b\[[0-9;]*m/g;

const green = (str) => `\x1b[32m${str}\x1b[0m`;
const red = (str) => `\x1b[31m${str}\x1b[0m`;
const yellow = (str) => `\x1b[33m${str}\x1b[0m`;
const cyan = (str) => `\x1b[36m${str}\x1b[0m`;
const gray = (str) => `\x1b[90m${str}\x1b[0m`;
const bold = (str) => `\x1b[1m${str}\x1b[0m`;

function stripAnsi(str) {
  return String(str).replace(ANSI_RE, '');
}

function padR(str, len) {
  const value = String(str);
  return value + ' '.repeat(Math.max(0, len - stripAnsi(value).length));
}

function padL(str, len) {
  const value = String(str);
  return ' '.repeat(Math.max(0, len - stripAnsi(value).length)) + value;
}

function shortWallet(address) {
  const value = String(address || '-');
  return value.length > 13 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function fmtCompact(value) {
  const abs = Math.abs(value || 0);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return (value || 0).toFixed(2);
}

function fmtUsd(value, signed = false) {
  const numeric = Number.isFinite(value) ? value : 0;
  const sign = signed && numeric > 0 ? '+' : '';
  return `${sign}$${Math.abs(numeric).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.replace('$-', '-$');
}

function fmtSignedUsd(value) {
  const formatted = `${value >= 0 ? '+' : '-'}$${Math.abs(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  if (value > 0) {
    return green(formatted);
  }
  if (value < 0) {
    return red(formatted);
  }
  return gray(formatted);
}

function fmtSol(value) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} SOL`;
}

function fmtFeeRate(value) {
  const numeric = Number.parseFloat(value) || 0;
  return `${numeric.toFixed(2)}%`;
}

function rankLabel(rank) {
  if (rank === 1) return '#1';
  if (rank === 2) return '#2';
  if (rank === 3) return '#3';
  return String(rank).padStart(2, '0');
}

function tableLine(width = 96) {
  return gray('-'.repeat(width));
}

export function printLeaderboard(lbResult) {
  const rows = lbResult.rankings || [];
  const pool = lbResult.pool || {};
  const meta = lbResult.meta || {};
  const modeLabel = meta.mode === 'losers' ? 'TOP LOSERS' : 'TOP WINNERS';
  const totalPnl = rows.reduce((sum, row) => sum + (row.pnlUsd || 0), 0);
  const avgPnl = rows.length > 0 ? totalPnl / rows.length : 0;

  process.stdout.write(`${bold(pool.name || 'Meteora pool')} ${gray(pool.address || '')}\n`);
  process.stdout.write(
    `${cyan(modeLabel)} | TVL: $${fmtCompact(pool.tvlUsd)} | Vol 24h: $${fmtCompact(pool.volumeUsd24h)} | Fee: ${fmtFeeRate(pool.feeRate)} | Wallets: ${rows.length}\n`,
  );
  process.stdout.write(`${tableLine()}\n`);
  process.stdout.write(
    `${padR('#', 5)} ${padR('Wallet', 17)} ${padL('PnL USD', 16)} ${padL('PnL SOL', 16)} ${padL('Fees', 14)} ${padL('Pos', 5)}\n`,
  );
  process.stdout.write(`${tableLine()}\n`);

  for (const row of rows) {
    process.stdout.write([
      padR(rankLabel(row.rank), 5),
      padR(shortWallet(row.wallet), 17),
      padL(fmtSignedUsd(row.pnlUsd || 0), 16),
      padL(fmtSol(row.pnlSol || 0), 16),
      padL(fmtUsd(row.feesEarnedUsd || 0), 14),
      padL(row.positionCount || 0, 5),
    ].join(' ') + '\n');
  }

  process.stdout.write(`${tableLine()}\n`);
  process.stdout.write(
    `Total PnL: ${fmtSignedUsd(totalPnl)} | Avg: ${fmtSignedUsd(avgPnl)} | SOL: $${(meta.solPrice || 0).toFixed(2)} | ${((meta.durationMs || 0) / 1000).toFixed(1)}s\n`,
  );
}

export function printPoolInfo(pool) {
  process.stdout.write([
    padR(pool.name || 'Unknown', 24),
    padR(shortWallet(pool.address), 16),
    padL(`$${fmtCompact(pool.tvlUsd || 0)}`, 12),
    padL(`$${fmtCompact(pool.volumeUsd24h || 0)}`, 12),
    padL(fmtFeeRate(pool.feeRate || 0), 8),
  ].join(' ') + '\n');
}

export function printPools(pools) {
  process.stdout.write(`${padR('Pool', 24)} ${padR('Address', 16)} ${padL('TVL', 12)} ${padL('Vol 24h', 12)} ${padL('Fee', 8)}\n`);
  process.stdout.write(`${tableLine(78)}\n`);
  for (const pool of pools) {
    printPoolInfo(pool);
  }
}

export function printProgress(done, total, label = 'Computing PnL') {
  const width = 20;
  const filled = total > 0 ? Math.round((done / total) * width) : 0;
  const bar = `${'#'.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}`;
  process.stderr.write(`\r${label}... [${bar}] ${done}/${total}`);
  if (done >= total) {
    process.stderr.write('\n');
  }
}

export function printError(message) {
  process.stderr.write(`${red(`Error: ${message}`)}\n`);
}

export function printBanner({ pool, pools, mode, limit, concurrency }) {
  process.stderr.write('lpGoose Leaderboard v2.0.0 - Self-computed PnL\n');
  process.stderr.write(`   Pool: ${pool || pools || 'default'}\n`);
  process.stderr.write(`   Mode: ${mode} | Limit: ${limit} | Concurrency: ${concurrency}\n`);
}

export function printHelp() {
  process.stdout.write(`Meteora DLMM LP Leaderboard v2.0.0

Usage:
  node src/cli.js [options]

Options:
  --pool <address>         Pool address (default: DEFAULT_POOL)
  --pools <addr,addr>      Multiple pool addresses
  --mode winners|losers    Sort order (default: winners)
  --losers                 Shortcut for --mode losers
  --limit <number>         Max positions to scan
  --top-pools              Show top pools by volume
  --search <query>         Search pool by symbol, name, mint, or address
  --wallet <address>       Reserved for a future wallet view
  --json                   Output JSON to stdout
  --no-cache               Clear in-memory cache before running
  --help                   Show this help
  --verbose                Print debug logs to stderr

Examples:
  node src/cli.js
  node src/cli.js --losers
  node src/cli.js --pool 5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6
  node src/cli.js --search SOL-USDC
  node src/cli.js --top-pools
  node src/cli.js --json
`);
}

export { green, red, yellow, cyan, gray, bold, stripAnsi, padR, padL };
