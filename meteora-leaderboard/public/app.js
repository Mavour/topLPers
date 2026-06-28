const state = {
  activeView: 'leaderboard',
  lastWalletParams: null,
};

const els = {
  healthStatus: document.querySelector('#healthStatus'),
  walletPanel: document.querySelector('#walletPanel'),
  walletForm: document.querySelector('#walletForm'),
  refreshButton: document.querySelector('#refreshButton'),
  messageBox: document.querySelector('#messageBox'),
  resultsBody: document.querySelector('#resultsBody'),
  solPrice: document.querySelector('#solPrice'),
  totalPnl: document.querySelector('#totalPnl'),
  avgPnl: document.querySelector('#avgPnl'),
  totalFees: document.querySelector('#totalFees'),
  tabs: Array.from(document.querySelectorAll('.tab-button')),
};

const base58Re = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function fmtUsd(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Math.abs(number) >= 1000 ? 0 : 2,
  }).format(number);
}

function fmtSol(value) {
  const number = Number(value) || 0;
  return `${number.toFixed(2)} SOL`;
}

function fmtWallet(value) {
  if (!value) {
    return '-';
  }
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function signClass(value) {
  const number = Number(value) || 0;
  if (number > 0) return 'positive';
  if (number < 0) return 'negative';
  return 'neutral';
}

function setLoading(isLoading) {
  document.querySelectorAll('button').forEach((button) => {
    button.disabled = isLoading || button.closest('.disabled') !== null;
  });
}

function setMetrics({ solPrice = null, totalPnl = null, avgPnl = null, totalFees = null } = {}) {
  els.solPrice.textContent = solPrice === null ? '-' : fmtUsd(solPrice);
  els.totalPnl.textContent = totalPnl === null ? '-' : fmtUsd(totalPnl);
  els.totalPnl.className = signClass(totalPnl);
  els.avgPnl.textContent = avgPnl === null ? '-' : fmtUsd(avgPnl);
  els.avgPnl.className = signClass(avgPnl);
  els.totalFees.textContent = totalFees === null ? '-' : fmtUsd(totalFees);
}

function showMessage(text, type = 'info') {
  els.messageBox.textContent = text;
  els.messageBox.className = `message ${type === 'error' ? 'error' : ''}`;
}

function hideMessage() {
  els.messageBox.className = 'message hidden';
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

function renderWallet(payload) {
  const portfolio = payload.data;
  const rows = portfolio.pools || [];
  const avgPnl = rows.length > 0 ? portfolio.totalPnlUsd / rows.length : 0;

  els.resultsBody.innerHTML = rows.map((row, index) => `
    <tr>
      <td data-label="#">${String(index + 1).padStart(2, '0')}</td>
      <td data-label="Wallet / Pool">
        <strong class="mono">${row.name || fmtWallet(row.poolAddress)}</strong>
        <small class="mono">${fmtWallet(row.poolAddress)}</small>
      </td>
      <td data-label="PnL SOL" class="neutral">-</td>
      <td data-label="PnL USD" class="${signClass(row.pnlUsd)}">${fmtUsd(row.pnlUsd)}</td>
      <td data-label="Fees USD">${fmtUsd(row.feesUsd)}</td>
      <td data-label="Pos."><span class="pos-pill">${row.inRange ? 'IN' : 'OOR'}</span></td>
    </tr>
  `).join('');

  setMetrics({
    solPrice: payload.solPrice,
    totalPnl: portfolio.totalPnlUsd,
    avgPnl,
    totalFees: portfolio.totalFeesUsd,
  });

  if (rows.length === 0) {
    showMessage('Wallet loaded. No DLMM pools were returned for this address.');
  } else {
    hideMessage();
  }
}

function renderUnavailable(view) {
  els.resultsBody.innerHTML = '';
  setMetrics();
  const label = view === 'pool' ? 'Pool PnL' : 'Leaderboard';
  showMessage(`${label} is unavailable because Meteora does not expose a working public endpoint for this view right now. Wallet Lookup is live.`);
}

function setView(view) {
  state.activeView = view;
  els.tabs.forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  els.walletPanel.classList.toggle('hidden', view !== 'wallet');

  if (view === 'wallet') {
    showMessage('Enter a wallet address and load live Meteora portfolio data.');
    return;
  }

  renderUnavailable(view);
}

async function loadWallet(formData) {
  const address = String(formData.get('address') || '').trim();
  if (!base58Re.test(address)) {
    throw new Error('Wallet address is not a valid Solana base58 address.');
  }

  const params = new URLSearchParams({ address });
  state.lastWalletParams = params;
  const payload = await fetchJson(`/api/wallet?${params.toString()}`);
  renderWallet(payload);
}

async function runQuery(handler) {
  setLoading(true);
  showMessage('Loading data...');
  try {
    await handler();
  } catch (error) {
    els.resultsBody.innerHTML = '';
    setMetrics();
    showMessage(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    setLoading(false);
  }
}

async function checkHealth() {
  try {
    await fetchJson('/api/health');
    els.healthStatus.textContent = 'API online';
    els.healthStatus.className = 'status-pill ok';
  } catch {
    els.healthStatus.textContent = 'API offline';
    els.healthStatus.className = 'status-pill bad';
  }
}

els.tabs.forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

els.walletForm.addEventListener('submit', (event) => {
  event.preventDefault();
  setView('wallet');
  runQuery(() => loadWallet(new FormData(els.walletForm)));
});

els.refreshButton.addEventListener('click', () => {
  if (state.activeView !== 'wallet') {
    renderUnavailable(state.activeView);
    return;
  }
  if (!state.lastWalletParams) {
    showMessage('Enter a wallet address and load it first.');
    return;
  }
  runQuery(() => fetchJson(`/api/wallet?${state.lastWalletParams.toString()}`).then(renderWallet));
});

setView('leaderboard');
checkHealth();
