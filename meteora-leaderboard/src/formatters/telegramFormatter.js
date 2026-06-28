const MAX_MESSAGE_LENGTH = 4000;
const rankLabels = ['🥇', '🥈', '🥉'];

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtWallet(addr) {
  if (!addr) {
    return '-';
  }
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

function suffix(value, digits = 0) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toFixed(digits);
}

function fmtUsd(n) {
  const value = Number.isFinite(Number(n)) ? Number(n) : 0;
  return `${value > 0 ? '+' : ''}$${suffix(value)}`;
}

function fmtSol(n) {
  const value = Number.isFinite(Number(n)) ? Number(n) : 0;
  return `${value > 0 ? '+' : ''}${value.toFixed(4)} SOL`;
}

function pnlEmoji(n) {
  if (n > 0) {
    return '📈';
  }
  if (n < 0) {
    return '📉';
  }
  return '➖';
}

function periodLabel(period) {
  if (String(period).toLowerCase() === 'all') {
    return 'All time';
  }
  return `Last ${String(period).replace('d', '')} days`;
}

function timestampWib() {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

function fitMessage(lines) {
  const output = [];
  let hidden = 0;

  for (const line of lines) {
    const next = [...output, line].join('\n');
    if (next.length > MAX_MESSAGE_LENGTH) {
      hidden += 1;
    } else {
      output.push(line);
    }
  }

  if (hidden > 0) {
    output.push(`<i>dan ${hidden} lainnya...</i>`);
  }

  return output.join('\n');
}

export function formatLeaderboard(rows, opts = {}, solPrice = 150) {
  const { mode = 'winners', period = '7', pool = null } = opts;
  const title = mode === 'losers' ? '📉 <b>Top LP Losers</b>' : '🏆 <b>Top LP Winners</b>';
  const scope = pool ? `Pool <code>${esc(fmtWallet(pool))}</code>` : 'Global';
  const totalPnl = rows.reduce((total, row) => total + (row.pnlUsd || 0), 0);
  const totalFees = rows.reduce((total, row) => total + (row.feesUsd || 0), 0);
  const avgPnl = rows.length ? totalPnl / rows.length : 0;
  const lines = [
    title,
    `📅 ${esc(periodLabel(period))} • ${scope}`,
    '',
    ...rows.map((row, index) => {
      const rank = rankLabels[index] || `${index + 1}.`;
      return `${rank} <code>${esc(fmtWallet(row.wallet))}</code> ${pnlEmoji(row.pnlUsd)} ${esc(fmtUsd(row.pnlUsd))} | Fees: ${esc(fmtUsd(row.feesUsd))}`;
    }),
    '',
    `<i>📊 Total PnL: ${esc(fmtUsd(totalPnl))} | Avg: ${esc(fmtUsd(avgPnl))} | Fees: ${esc(fmtUsd(totalFees))}</i>`,
    `<i>💰 SOL: $${Number(solPrice).toFixed(2)} | 🕐 Updated: ${timestampWib()} WIB</i>`,
  ];

  return fitMessage(lines);
}

export function formatWalletPortfolio(portfolio, solPrice = 150) {
  const pools = portfolio.pools || [];
  const visiblePools = pools.slice(0, 10);
  const lines = [
    '👛 <b>Wallet Portfolio</b>',
    `<code>${esc(portfolio.wallet)}</code>`,
    '',
    `PnL USD: ${pnlEmoji(portfolio.totalPnlUsd)} <b>${esc(fmtUsd(portfolio.totalPnlUsd))}</b>`,
    `PnL SOL: <b>${esc(fmtSol(portfolio.totalPnlSol))}</b>`,
    `Fees: <b>${esc(fmtUsd(portfolio.totalFeesUsd))}</b>`,
    `Open positions: <b>${esc(portfolio.openPositions)}</b>`,
    `SOL: <b>$${Number(solPrice).toFixed(2)}</b>`,
    '',
    '<b>Pools</b>',
    ...visiblePools.map((pool, index) => {
      const range = pool.inRange ? '🟢 IN' : '🟡 OOR';
      return `${index + 1}. <b>${esc(pool.name)}</b> ${range}\n<code>${esc(fmtWallet(pool.poolAddress))}</code> | PnL ${esc(fmtUsd(pool.pnlUsd))} | Fees ${esc(fmtUsd(pool.feesUsd))}`;
    }),
  ];

  if (pools.length > visiblePools.length) {
    lines.push(`<i>dan ${pools.length - visiblePools.length} pool lainnya...</i>`);
  }

  return fitMessage(lines);
}

export function formatError(errorMessage) {
  return `⚠️ <b>Request failed</b>\n<code>${esc(errorMessage)}</code>\n\n<i>Coba ulang beberapa menit lagi. Endpoint Meteora kadang rate-limit atau berubah format.</i>`;
}

export function formatHelp() {
  return [
    '<b>Meteora DLMM LP Leaderboard</b>',
    '',
    '<code>/leaderboard</code> - global top winners',
    '<code>/leaderboard losers</code> - global top losers',
    '<code>/leaderboard 30</code> - winners last 30 days',
    '<code>/leaderboard losers 30</code> - losers last 30 days',
    '',
    '<code>/pool &lt;address&gt;</code> - top LPers in a pool',
    '<code>/pool &lt;address&gt; losers 30</code> - pool losers for 30 days',
    '',
    '<code>/wallet &lt;address&gt;</code> - wallet portfolio detail',
    '<code>/ping</code> - health check',
  ].join('\n');
}

export function splitTelegramMessage(message, maxLength = MAX_MESSAGE_LENGTH) {
  if (message.length <= maxLength) {
    return [message];
  }

  const chunks = [];
  let current = '';
  for (const line of message.split('\n')) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength) {
      if (current) {
        chunks.push(current);
      }
      current = line;
    } else {
      current = next;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}
