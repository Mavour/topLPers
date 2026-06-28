const state = {
  mode: 'winners',
  period: '7',
  view: 'leaderboard',
  pool: '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',
  limit: 20,
  last: null,
};

const el = {
  status: document.querySelector('#status'),
  poolInput: document.querySelector('#poolInput'),
  refreshButton: document.querySelector('#refreshButton'),
  loadPoolButton: document.querySelector('#loadPoolButton'),
  leaderboardBody: document.querySelector('#leaderboardBody'),
  totalPnl: document.querySelector('#totalPnl'),
  avgPnl: document.querySelector('#avgPnl'),
  feesEarned: document.querySelector('#feesEarned'),
  solPrice: document.querySelector('#solPrice'),
  walletInput: document.querySelector('#walletInput'),
  lookupButton: document.querySelector('#lookupButton'),
  walletResult: document.querySelector('#walletResult'),
  poolName: document.querySelector('#poolName'),
  poolPositions: document.querySelector('#poolPositions'),
  poolPnl: document.querySelector('#poolPnl'),
  poolFees: document.querySelector('#poolFees'),
};

el.poolInput.value = state.pool;

function shortAddress(value) {
  if (!value) return '-';
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function usd(value, digits = 0) {
  const number = Number(value) || 0;
  const sign = number > 0 ? '+' : number < 0 ? '-' : '';
  return `${sign}$${Math.abs(number).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function sol(value) {
  const number = Number(value) || 0;
  return `${number.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} SOL`;
}

function setTone(node, value) {
  node.classList.toggle('positive', value > 0);
  node.classList.toggle('negative', value < 0);
}

function setStatus(message, isError = false) {
  el.status.textContent = message || '';
  el.status.classList.toggle('error', isError);
}

async function api(path, params = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  const response = await fetch(url);
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.error || `HTTP ${response.status}`);
  }
  return json;
}

function renderStats(result) {
  const rows = result.rankings.slice(0, 20);
  const total = rows.reduce((sum, row) => sum + (row.pnlUsd || 0), 0);
  const fees = rows.reduce((sum, row) => sum + (row.feesEarnedUsd || 0) + (row.unclaimedFeesUsd || 0), 0);
  const avg = rows.length ? total / rows.length : 0;

  el.totalPnl.textContent = usd(total);
  el.avgPnl.textContent = usd(avg);
  el.feesEarned.textContent = usd(fees);
  el.solPrice.textContent = `$${(result.meta.solPrice || 0).toFixed(2)}`;
  setTone(el.totalPnl, total);
  setTone(el.avgPnl, avg);
}

function renderRows(result) {
  el.leaderboardBody.innerHTML = '';
  for (const row of result.rankings.slice(0, 20)) {
    const tr = document.createElement('tr');
    const pnlClass = row.pnlUsd > 0 ? 'positive' : row.pnlUsd < 0 ? 'negative' : '';
    tr.innerHTML = `
      <td>${String(row.rank).padStart(2, '0')}</td>
      <td>
        <div class="wallet">
          <strong>${shortAddress(row.wallet)}</strong>
          <small>${row.wallet}</small>
        </div>
      </td>
      <td class="${pnlClass}">${sol(row.pnlSol)}</td>
      <td class="${pnlClass}">${usd(row.pnlUsd, 2)}</td>
      <td>${usd((row.feesEarnedUsd || 0) + (row.unclaimedFeesUsd || 0), 2).replace('+', '')}</td>
      <td><span class="pos-pill">${row.positionCount || 0}</span></td>
    `;
    el.leaderboardBody.appendChild(tr);
  }
}

function renderPool(result) {
  const rows = result.rankings;
  const total = rows.reduce((sum, row) => sum + (row.pnlUsd || 0), 0);
  const fees = rows.reduce((sum, row) => sum + (row.feesEarnedUsd || 0) + (row.unclaimedFeesUsd || 0), 0);
  const positions = rows.reduce((sum, row) => sum + (row.positionCount || 0), 0);

  el.poolName.textContent = result.pool.name || shortAddress(result.pool.address);
  el.poolPositions.textContent = positions.toLocaleString();
  el.poolPnl.textContent = usd(total);
  el.poolFees.textContent = usd(fees);
  setTone(el.poolPnl, total);
}

async function loadLeaderboard(refresh = false) {
  setStatus('Computing leaderboard from position history and live DLMM positions...');
  el.refreshButton.disabled = true;
  try {
    const { result } = await api('/api/leaderboard', {
      pool: state.pool,
      mode: state.mode,
      period: state.period,
      limit: state.limit,
      refresh: refresh ? '1' : '',
    });
    state.last = result;
    renderStats(result);
    renderRows(result);
    renderPool(result);
    setStatus(`Updated ${new Date(result.meta.computedAt).toLocaleTimeString()} from ${result.meta.totalPositions} positions.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    el.refreshButton.disabled = false;
  }
}

async function lookupWallet() {
  const wallet = el.walletInput.value.trim();
  if (!wallet) {
    el.walletResult.textContent = 'Enter a wallet address.';
    return;
  }
  setStatus('Computing wallet PnL from position history and live DLMM value...');
  try {
    const { row, pool } = await api('/api/wallet', {
      wallet,
      pool: state.pool,
      limit: 300,
    });
    if (!row) {
      el.walletResult.innerHTML = `No scanned position found for <strong>${wallet}</strong> in ${pool.name}.`;
      setStatus('');
      return;
    }
    const pnlClass = row.pnlUsd > 0 ? 'positive' : row.pnlUsd < 0 ? 'negative' : '';
    el.walletResult.innerHTML = `
      <strong>${shortAddress(row.wallet)}</strong><br>
      <span class="${pnlClass}">${usd(row.pnlUsd, 2)} / ${sol(row.pnlSol)}</span><br>
      Current LP: ${usd(row.currentPositionUsd, 2).replace('+', '')} · Fees: ${usd((row.feesEarnedUsd || 0) + (row.unclaimedFeesUsd || 0), 2).replace('+', '')} · Positions: ${row.positionCount}
    `;
    setStatus('');
  } catch (error) {
    setStatus(error.message, true);
  }
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((panel) => panel.classList.remove('active'));
  document.querySelector(`#${view}View`).classList.add('active');
}

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((item) => item.classList.toggle('active', item === button));
    loadLeaderboard(false);
  });
});

document.querySelectorAll('[data-period]').forEach((button) => {
  button.addEventListener('click', () => {
    state.period = button.dataset.period;
    document.querySelectorAll('[data-period]').forEach((item) => item.classList.toggle('active', item === button));
    loadLeaderboard(false);
  });
});

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});

el.refreshButton.addEventListener('click', () => loadLeaderboard(true));
el.loadPoolButton.addEventListener('click', () => {
  state.pool = el.poolInput.value.trim() || state.pool;
  loadLeaderboard(true);
});
el.lookupButton.addEventListener('click', lookupWallet);
el.walletInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') lookupWallet();
});

loadLeaderboard(false);
