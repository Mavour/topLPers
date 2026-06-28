const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

const rankLabels = ['🥇', '🥈', '🥉'];

function colorize(str, color) {
  return `${COLORS[color] || ''}${str}${COLORS.reset}`;
}

function stripAnsi(str) {
  return String(str).replace(/\x1b\[[0-9;]*m/g, '');
}

function pad(str, len) {
  const value = String(str);
  const visible = stripAnsi(value).length;
  return visible >= len ? value : `${value}${' '.repeat(len - visible)}`;
}

function fmtWallet(addr) {
  if (!addr) {
    return '-';
  }
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

function suffix(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return value.toFixed(2);
}

function signed(value, prefix = '') {
  return `${value > 0 ? '+' : ''}${prefix}${suffix(value)}`;
}

function colorBySign(value, text) {
  if (value > 0) {
    return colorize(text, 'green');
  }
  if (value < 0) {
    return colorize(text, 'red');
  }
  return colorize(text, 'gray');
}

function fmtUsd(n, colored = false) {
  const value = Number.isFinite(Number(n)) ? Number(n) : 0;
  const text = signed(value, '$');
  return colored ? colorBySign(value, text) : text;
}

function fmtSol(n, colored = false) {
  const value = Number.isFinite(Number(n)) ? Number(n) : 0;
  const text = `${value > 0 ? '+' : ''}${value.toFixed(4)} SOL`;
  return colored ? colorBySign(value, text) : text;
}

function periodLabel(period) {
  if (String(period).toLowerCase() === 'all') {
    return 'All time';
  }
  return `Last ${String(period).replace('d', '')} days`;
}

function rankLabel(index) {
  return rankLabels[index] || String(index + 1);
}

export function printLeaderboard(rows, opts = {}, solPrice = 150) {
  const { mode = 'winners', limit = rows.length, period = '7', pool = null } = opts;
  const title = mode === 'losers' ? '📉 TOP LP LOSERS' : '🏆 TOP LP WINNERS';
  const scope = pool ? `Pool ${fmtWallet(pool)}` : 'Global';
  const line = '─'.repeat(96);
  const totalPnl = rows.reduce((total, row) => total + (row.pnlUsd || 0), 0);
  const totalFees = rows.reduce((total, row) => total + (row.feesUsd || 0), 0);
  const avgPnl = rows.length ? totalPnl / rows.length : 0;

  const output = [
    `${colorize(title, mode === 'losers' ? 'red' : 'green')} - ${scope} (${periodLabel(period)})`,
    line,
    `${pad('#', 5)}${pad('Wallet', 18)}${pad('PnL SOL', 18)}${pad('PnL USD', 18)}${pad('Fees USD', 16)}Positions`,
    line,
    ...rows.map((row, index) => [
      pad(rankLabel(index), 5),
      pad(fmtWallet(row.wallet), 18),
      pad(fmtSol(row.pnlSol, true), 18),
      pad(fmtUsd(row.pnlUsd, true), 18),
      pad(fmtUsd(row.feesUsd, false), 16),
      row.positions || 0,
    ].join('')),
    line,
    'Summary Stats:',
    `  Wallets shown  : ${rows.length} of ${limit} requested`,
    `  Total PnL USD  : ${fmtUsd(totalPnl, true)}`,
    `  Avg PnL USD    : ${fmtUsd(avgPnl, true)}`,
    `  Total Fees USD : ${fmtUsd(totalFees, false)}`,
    `  SOL Price      : $${Number(solPrice).toFixed(2)}`,
  ];

  process.stdout.write(`${output.join('\n')}\n`);
}

export function printWalletPortfolio(portfolio, solPrice = 150) {
  const line = '─'.repeat(88);
  const rows = portfolio.pools || [];
  const output = [
    `${colorize('Wallet Portfolio', 'cyan')} ${fmtWallet(portfolio.wallet)}`,
    line,
    `Total PnL USD  : ${fmtUsd(portfolio.totalPnlUsd, true)}`,
    `Total PnL SOL  : ${fmtSol(portfolio.totalPnlSol, true)}`,
    `Total Fees USD : ${fmtUsd(portfolio.totalFeesUsd, false)}`,
    `Open Positions : ${portfolio.openPositions}`,
    `SOL Price      : $${Number(solPrice).toFixed(2)}`,
    line,
    `${pad('Pool', 24)}${pad('PnL USD', 16)}${pad('Fees USD', 16)}${pad('TVL USD', 16)}Range`,
    line,
    ...rows.map((row) => [
      pad(row.name || fmtWallet(row.poolAddress), 24),
      pad(fmtUsd(row.pnlUsd, true), 16),
      pad(fmtUsd(row.feesUsd, false), 16),
      pad(fmtUsd(row.tvlUsd, false), 16),
      row.inRange ? colorize('IN', 'green') : colorize('OOR', 'yellow'),
    ].join('')),
  ];

  process.stdout.write(`${output.join('\n')}\n`);
}
