const state = {
  lastQuery: 'wallet',
  lastParams: null,
  rows: [],
};

const els = {
  healthStatus: document.querySelector('#healthStatus'),
  walletForm: document.querySelector('#walletForm'),
  refreshButton: document.querySelector('#refreshButton'),
  messageBox: document.querySelector('#messageBox'),
  resultsBody: document.querySelector('#resultsBody'),
  resultTitle: document.querySelector('#resultTitle'),
  resultScope: document.querySelector('#resultScope'),
  solPrice: document.querySelector('#solPrice'),
  totalPnl: document.querySelector('#totalPnl'),
  totalFees: document.querySelector('#totalFees'),
  updatedAt: document.querySelector('#updatedAt'),
  rangeCanvas: document.querySelector('#rangeCanvas'),
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
  return `${number.toFixed(4)} SOL`;
}

function fmtWallet(value) {
  if (!value) {
    return '-';
  }
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function signClass(value) {
  const number = Number(value) || 0;
  if (number > 0) {
    return 'positive';
  }
  if (number < 0) {
    return 'negative';
  }
  return 'neutral';
}

function setLoading(isLoading) {
  document.querySelectorAll('button').forEach((button) => {
    button.disabled = isLoading;
  });
}

function showMessage(text, type = 'info') {
  els.messageBox.textContent = text;
  els.messageBox.className = `message ${type === 'error' ? 'error' : ''}`;
}

function hideMessage() {
  els.messageBox.className = 'message hidden';
}

function setMetrics({ solPrice = null, totalPnl = null, totalFees = null, updatedAt = null }) {
  els.solPrice.textContent = solPrice === null ? '-' : fmtUsd(solPrice);
  els.totalPnl.textContent = totalPnl === null ? '-' : fmtUsd(totalPnl);
  els.totalPnl.className = signClass(totalPnl);
  els.totalFees.textContent = totalFees === null ? '-' : fmtUsd(totalFees);
  els.updatedAt.textContent = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
}

function drawRange(rows = []) {
  const canvas = els.rangeCanvas;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = '#fbfcfa';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#d9e0da';
  ctx.lineWidth = 1;
  for (let index = 0; index < 5; index += 1) {
    const y = 36 + index * 42;
    ctx.beginPath();
    ctx.moveTo(24, y);
    ctx.lineTo(width - 24, y);
    ctx.stroke();
  }

  const visible = rows.slice(0, 18);
  const max = Math.max(...visible.map((row) => Math.abs(Number(row.pnlUsd || row.feesUsd || 0))), 1);
  const barGap = 6;
  const barWidth = Math.max(8, (width - 56 - barGap * Math.max(visible.length - 1, 0)) / Math.max(visible.length, 1));
  const mid = Math.floor(height * 0.58);

  ctx.strokeStyle = '#637065';
  ctx.beginPath();
  ctx.moveTo(22, mid);
  ctx.lineTo(width - 22, mid);
  ctx.stroke();

  visible.forEach((row, index) => {
    const value = Number(row.pnlUsd || row.feesUsd || 0);
    const magnitude = Math.max(6, Math.abs(value) / max * 96);
    const x = 28 + index * (barWidth + barGap);
    const y = value >= 0 ? mid - magnitude : mid;
    ctx.fillStyle = value >= 0 ? '#147d54' : '#b83c3c';
    ctx.fillRect(x, y, barWidth, magnitude);
  });

  if (visible.length === 0) {
    ctx.fillStyle = '#637065';
    ctx.font = '16px system-ui';
    ctx.fillText('No range data loaded', 28, 52);
  }
}

function renderWallet(payload) {
  const portfolio = payload.data;
  const rows = portfolio.pools || [];
  els.resultTitle.textContent = 'Wallet Portfolio';
  els.resultScope.textContent = fmtWallet(portfolio.wallet);
  els.resultsBody.innerHTML = rows.map((row, index) => `
    <tr>
      <td data-label="Rank">${index + 1}</td>
      <td data-label="Pool" class="mono" title="${row.poolAddress}">${row.name || fmtWallet(row.poolAddress)}</td>
      <td data-label="PnL USD" class="${signClass(row.pnlUsd)}">${fmtUsd(row.pnlUsd)}</td>
      <td data-label="Fees USD">${fmtUsd(row.feesUsd)}</td>
      <td data-label="Range">${row.inRange ? 'In range' : 'Out of range'}</td>
    </tr>
  `).join('');
  setMetrics({
    solPrice: payload.solPrice,
    totalPnl: portfolio.totalPnlUsd,
    totalFees: portfolio.totalFeesUsd,
    updatedAt: payload.updatedAt,
  });
  drawRange(rows);
  if (rows.length === 0) {
    showMessage('Wallet loaded. No DLMM pools were returned for this address.');
  } else {
    hideMessage();
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

async function loadWallet(formData) {
  const address = String(formData.get('address') || '').trim();
  if (!base58Re.test(address)) {
    throw new Error('Wallet address is not a valid Solana base58 address.');
  }

  const params = new URLSearchParams({ address });
  state.lastQuery = 'wallet';
  state.lastParams = params;
  const payload = await fetchJson(`/api/wallet?${params.toString()}`);
  state.rows = payload.data?.pools || [];
  renderWallet(payload);
}

async function runQuery(handler) {
  setLoading(true);
  showMessage('Loading data...');
  try {
    await handler();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    els.resultsBody.innerHTML = '';
    setMetrics({});
    drawRange([]);
    showMessage(message, 'error');
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

els.walletForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(els.walletForm);
  runQuery(() => loadWallet(formData));
});

els.refreshButton.addEventListener('click', () => {
  if (!state.lastParams) {
    showMessage('Run a query first.');
    return;
  }
  runQuery(() => (
    fetchJson(`/api/wallet?${state.lastParams.toString()}`).then(renderWallet)
  ));
});

drawRange([]);
checkHealth();
