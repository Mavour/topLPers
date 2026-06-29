const state = {
  mode: 'winners',
  period: '7',
  poolFilter: null,
  offset: 0,
  limit: 50,
};

const el = {
  status: document.getElementById('status'),
  poolInput: document.getElementById('poolInput'),
  refreshButton: document.getElementById('refreshButton'),
  loadPoolButton: document.getElementById('loadPoolButton'),
  tableBody: document.getElementById('tableBody'),
  emptyState: document.getElementById('emptyState'),
  totalPnl: document.getElementById('totalPnl'),
  avgPnl: document.getElementById('avgPnl'),
  feesEarned: document.getElementById('feesEarned'),
  poolCount: document.getElementById('poolCount'),
};

const copyIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const checkIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';

function formatUsd(n, digits = 0) {
  const value = Number(n) || 0;
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function formatSol(n) {
  const value = Number(n) || 0;
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SOL`;
}

function shortAddress(addr) {
  return addr && addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr || '-';
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const dateMs = new Date(ts).getTime();
  if (!Number.isFinite(dateMs)) return '-';
  const seconds = Math.max(1, Math.floor((Date.now() - dateMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function api(path, params = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  const response = await fetch(url);
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

function setStatus(message, isError = false) {
  if (!el.status) return;
  el.status.textContent = message || '';
  el.status.classList.toggle('error', isError);
}

function renderStats(result) {
  const rows = result.rankings || [];
  const total = rows.reduce((sum, row) => sum + (row.pnlUsd || 0), 0);
  const fees = rows.reduce((sum, row) => sum + (row.feesEarnedUsd || 0), 0);
  const avg = rows.length ? total / rows.length : 0;
  el.totalPnl.textContent = formatUsd(total);
  el.avgPnl.textContent = formatUsd(avg);
  el.feesEarned.textContent = formatUsd(fees);
  el.poolCount.textContent = String(result.meta?.indexedPools || 0);
  el.totalPnl.className = total >= 0 ? 'positive' : 'negative';
  el.avgPnl.className = avg >= 0 ? 'positive' : 'negative';
}

function renderRows(result) {
  el.tableBody.innerHTML = '';
  const rows = result.rankings || [];
  for (const row of rows) {
    const pnlClass = row.pnlUsd >= 0 ? 'positive' : 'negative';
    const tr = document.createElement('tr');
    tr.dataset.wallet = row.wallet;
    const poolName = row.bestPoolName || '-';
    const poolTitle = row.bestPoolAddress || poolName;
    tr.innerHTML = `
      <td class="rank">${String(row.rank).padStart(2, '0')}</td>
      <td>
        <div class="wallet">
          <div class="wallet-cell">
            <span class="wallet-short">${shortAddress(row.wallet)}</span>
            <button class="btn-copy" data-addr="${row.wallet}" title="Copy address" type="button">${copyIcon}</button>
          </div>
          <small>${escHtml(row.wallet)}</small>
        </div>
      </td>
      <td class="${pnlClass}">${formatSol(row.pnlSol)}</td>
      <td class="${pnlClass}">${formatUsd(row.pnlUsd, 2)}</td>
      <td>${formatUsd(row.feesEarnedUsd, 2).replace('+', '')}</td>
      <td title="${escHtml(poolTitle)}"><div>${escHtml(poolName)}</div><small>${timeAgo(row.lastUpdated)}</small></td>
      <td><span class="pos-pill">${row.positionCount || 0}</span></td>
    `;
    el.tableBody.appendChild(tr);
  }
  el.emptyState.hidden = rows.length > 0;
  if (!rows.length) {
    el.emptyState.innerHTML = '<h3>No data yet</h3><p>Trigger an index run to populate the leaderboard.</p>';
  }
}

async function fetchLeaderboard() {
  setStatus('Loading leaderboard...');
  try {
    const result = await api('/api/leaderboard', {
      mode: state.mode,
      period: state.period,
      limit: state.limit,
      offset: state.offset,
      pool: state.poolFilter,
    });
    renderStats(result);
    renderRows(result);
    setStatus(`Showing ${result.rankings.length}/${result.total} wallets.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function copyAddr(button) {
  const addr = button.dataset.addr;
  const done = () => {
    button.classList.add('copied');
    button.innerHTML = checkIcon;
    setTimeout(() => {
      button.classList.remove('copied');
      button.innerHTML = copyIcon;
    }, 1800);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(addr).then(done).catch(done);
  } else {
    done();
  }
}

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    state.offset = 0;
    document.querySelectorAll('[data-mode]').forEach((item) => item.classList.toggle('active', item === button));
    fetchLeaderboard();
  });
});

document.querySelectorAll('[data-period]').forEach((button) => {
  button.addEventListener('click', () => {
    state.period = button.dataset.period;
    state.offset = 0;
    document.querySelectorAll('[data-period]').forEach((item) => item.classList.toggle('active', item === button));
    fetchLeaderboard();
  });
});

el.tableBody?.addEventListener('click', (event) => {
  const copyButton = event.target.closest('.btn-copy');
  if (copyButton) copyAddr(copyButton);
});

el.refreshButton?.addEventListener('click', fetchLeaderboard);
el.loadPoolButton?.addEventListener('click', () => {
  state.poolFilter = el.poolInput.value.trim() || null;
  state.offset = 0;
  fetchLeaderboard();
});

document.addEventListener('DOMContentLoaded', fetchLeaderboard);
