function esc(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shortWallet(address) {
  const value = String(address || '-');
  return value.length > 13 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function fmtUsd(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}$${Math.abs(numeric).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtCompact(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(numeric);
  if (abs >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(numeric / 1_000).toFixed(2)}K`;
  return `$${numeric.toFixed(2)}`;
}

function rankLabel(index) {
  if (index === 0) return '1.';
  if (index === 1) return '2.';
  if (index === 2) return '3.';
  return `${index + 1}.`;
}

function formatFeeRate(value) {
  const numeric = Number.parseFloat(value) || 0;
  return `${numeric.toFixed(2)}%`;
}

export function formatLeaderboard(lbResult) {
  const pool = lbResult.pool || {};
  const meta = lbResult.meta || {};
  const rows = (lbResult.rankings || []).slice(0, 20);
  const hidden = Math.max(0, (lbResult.rankings || []).length - rows.length);
  const title = meta.mode === 'losers' ? 'Top LP Losers' : 'Top LP Winners';
  const lines = [
    `<b>${esc(title)}</b> - <code>${esc(pool.name || 'Meteora pool')}</code>`,
    `TVL: ${esc(fmtCompact(pool.tvlUsd || 0))} | Vol: ${esc(fmtCompact(pool.volumeUsd24h || 0))} | Fee: ${esc(formatFeeRate(pool.feeRate || 0))}`,
    '',
  ];

  rows.forEach((row, index) => {
    const pnl = fmtUsd(row.pnlUsd || 0);
    const pnlText = row.pnlUsd > 0 ? `<b>${esc(pnl)}</b>` : esc(pnl);
    lines.push(`${rankLabel(index)} <code>${esc(shortWallet(row.wallet))}</code> ${pnlText} | Fees: ${esc(fmtUsd(row.feesEarnedUsd || 0))}`);
  });

  if (hidden > 0) {
    lines.push(`...and ${hidden} more`);
  }

  lines.push('');
  lines.push(`<i>${meta.totalWallets || rows.length} wallets | SOL $${(meta.solPrice || 0).toFixed(2)} | ${((meta.durationMs || 0) / 1000).toFixed(1)}s</i>`);

  return lines.join('\n').slice(0, 4000);
}

export function formatPoolInfo(pool) {
  return [
    `<b>${esc(pool.name || 'Unknown pool')}</b>`,
    `<code>${esc(pool.address || '-')}</code>`,
    `TVL: ${esc(fmtCompact(pool.tvlUsd || 0))} | Vol: ${esc(fmtCompact(pool.volumeUsd24h || 0))} | Fee: ${esc(formatFeeRate(pool.feeRate || 0))}`,
  ].join('\n');
}

export function formatError(err) {
  const message = err instanceof Error ? err.message : String(err);
  let suggestion = 'Try again later or use a different pool address.';
  if (/timeout|abort/i.test(message)) {
    suggestion = 'The request timed out. Try a lower limit or lower concurrency.';
  } else if (/404|not found/i.test(message)) {
    suggestion = 'Pool or position was not found. Check the address.';
  } else if (/429|rate/i.test(message)) {
    suggestion = 'Rate limited. Lower CONCURRENCY and retry.';
  }
  return `<b>Error</b>\n${esc(message)}\n\n<i>${esc(suggestion)}</i>`;
}

export function formatHelp() {
  return `<b>Meteora DLMM LP Leaderboard</b>

/lb [pool_address] [winners|losers]
/leaderboard [pool_address] [winners|losers]
/pool &lt;pool_address&gt; [winners|losers]
/pools
/search &lt;query&gt;
/ping
/help`;
}

export function formatProgress(message) {
  return `${esc(message)}...`;
}
