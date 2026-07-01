import { getDb } from './schema.js';

const db = getDb();
const MAX_REASONABLE_USD = 100_000_000;
const MIN_RANKED_PNL_USD = 0.01;

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isReasonableUsd(value) {
  const parsed = finiteNumber(value);
  return Math.abs(parsed) <= MAX_REASONABLE_USD;
}

function isSuspectPnlRow(row) {
  return !isReasonableUsd(row.pnl_usd)
    || !isReasonableUsd(row.pnl_sol)
    || !isReasonableUsd(row.fees_earned_usd)
    || !isReasonableUsd(row.deposited_usd)
    || !isReasonableUsd(row.withdrawn_usd);
}

function cleanWalletPnlItem(item) {
  return {
    ...item,
    pnl_usd: isReasonableUsd(item.pnl_usd) ? finiteNumber(item.pnl_usd) : 0,
    pnl_sol: isReasonableUsd(item.pnl_sol) ? finiteNumber(item.pnl_sol) : 0,
    fees_earned_usd: isReasonableUsd(item.fees_earned_usd) ? finiteNumber(item.fees_earned_usd) : 0,
    deposited_usd: isReasonableUsd(item.deposited_usd) ? finiteNumber(item.deposited_usd) : 0,
    withdrawn_usd: isReasonableUsd(item.withdrawn_usd) ? finiteNumber(item.withdrawn_usd) : 0,
  };
}

function cleanWalletPosition(item) {
  return {
    ...item,
    pnl_usd: isReasonableUsd(item.pnl_usd) ? finiteNumber(item.pnl_usd) : 0,
    pnl_sol: finiteNumber(item.pnl_sol),
    fees_usd: isReasonableUsd(item.fees_usd) ? finiteNumber(item.fees_usd) : 0,
    pnl_1d_usd: isReasonableUsd(item.pnl_1d_usd) ? finiteNumber(item.pnl_1d_usd) : 0,
    pnl_1d_sol: finiteNumber(item.pnl_1d_sol),
    fees_1d_usd: isReasonableUsd(item.fees_1d_usd) ? finiteNumber(item.fees_1d_usd) : 0,
    pnl_7d_usd: isReasonableUsd(item.pnl_7d_usd) ? finiteNumber(item.pnl_7d_usd) : 0,
    pnl_7d_sol: finiteNumber(item.pnl_7d_sol),
    fees_7d_usd: isReasonableUsd(item.fees_7d_usd) ? finiteNumber(item.fees_7d_usd) : 0,
    deposited_usd: isReasonableUsd(item.deposited_usd) ? finiteNumber(item.deposited_usd) : 0,
    withdrawn_usd: isReasonableUsd(item.withdrawn_usd) ? finiteNumber(item.withdrawn_usd) : 0,
    current_value_usd: isReasonableUsd(item.current_value_usd) ? finiteNumber(item.current_value_usd) : 0,
  };
}

const upsertPoolStmt = db.prepare(`
  INSERT INTO pools (
    address, name, token_x_mint, token_y_mint, token_x_symbol, token_y_symbol,
    bin_step, fee_rate, tvl_usd, volume_24h_usd, last_indexed, position_count
  ) VALUES (
    @address, @name, @token_x_mint, @token_y_mint, @token_x_symbol, @token_y_symbol,
    @bin_step, @fee_rate, @tvl_usd, @volume_24h_usd, @last_indexed, @position_count
  )
  ON CONFLICT(address) DO UPDATE SET
    name = excluded.name,
    token_x_mint = excluded.token_x_mint,
    token_y_mint = excluded.token_y_mint,
    token_x_symbol = excluded.token_x_symbol,
    token_y_symbol = excluded.token_y_symbol,
    bin_step = excluded.bin_step,
    fee_rate = excluded.fee_rate,
    tvl_usd = excluded.tvl_usd,
    volume_24h_usd = excluded.volume_24h_usd,
    last_indexed = excluded.last_indexed,
    position_count = excluded.position_count
`);

const upsertWalletPnlStmt = db.prepare(`
  INSERT INTO wallet_pnl (
    wallet, pnl_usd, pnl_sol, fees_earned_usd, deposited_usd, withdrawn_usd,
    position_count, pool_count, last_updated
  ) VALUES (
    @wallet, @pnl_usd, @pnl_sol, @fees_earned_usd, @deposited_usd, @withdrawn_usd,
    @position_count, @pool_count, @last_updated
  )
  ON CONFLICT(wallet) DO UPDATE SET
    pnl_usd = excluded.pnl_usd,
    pnl_sol = excluded.pnl_sol,
    fees_earned_usd = excluded.fees_earned_usd,
    deposited_usd = excluded.deposited_usd,
    withdrawn_usd = excluded.withdrawn_usd,
    position_count = excluded.position_count,
    pool_count = excluded.pool_count,
    last_updated = excluded.last_updated
`);

const upsertWalletPoolPnlStmt = db.prepare(`
  INSERT INTO wallet_pool_pnl (
    wallet, pool_address, pool_name, pnl_usd, pnl_sol, fees_earned_usd,
    deposited_usd, withdrawn_usd, position_count, has_open, created_at, last_updated
  ) VALUES (
    @wallet, @pool_address, @pool_name, @pnl_usd, @pnl_sol, @fees_earned_usd,
    @deposited_usd, @withdrawn_usd, @position_count, @has_open, @created_at, @last_updated
  )
  ON CONFLICT(wallet, pool_address) DO UPDATE SET
    pool_name = excluded.pool_name,
    pnl_usd = excluded.pnl_usd,
    pnl_sol = excluded.pnl_sol,
    fees_earned_usd = excluded.fees_earned_usd,
    deposited_usd = excluded.deposited_usd,
    withdrawn_usd = excluded.withdrawn_usd,
    position_count = excluded.position_count,
    has_open = excluded.has_open,
    created_at = excluded.created_at,
    last_updated = excluded.last_updated
`);

const upsertWalletPositionStmt = db.prepare(`
  INSERT INTO wallet_positions (
    wallet, position_address, pool_address, pool_name, status, pnl_usd, pnl_sol,
    fees_usd, pnl_1d_usd, pnl_1d_sol, fees_1d_usd, pnl_7d_usd, pnl_7d_sol,
    fees_7d_usd, deposited_usd, withdrawn_usd, current_value_usd, created_at,
    closed_at, duration_seconds, bin_range, setup_json, last_updated
  ) VALUES (
    @wallet, @position_address, @pool_address, @pool_name, @status, @pnl_usd, @pnl_sol,
    @fees_usd, @pnl_1d_usd, @pnl_1d_sol, @fees_1d_usd, @pnl_7d_usd, @pnl_7d_sol,
    @fees_7d_usd, @deposited_usd, @withdrawn_usd, @current_value_usd, @created_at,
    @closed_at, @duration_seconds, @bin_range, @setup_json, @last_updated
  )
  ON CONFLICT(wallet, position_address) DO UPDATE SET
    pool_address = excluded.pool_address,
    pool_name = excluded.pool_name,
    status = excluded.status,
    pnl_usd = excluded.pnl_usd,
    pnl_sol = excluded.pnl_sol,
    fees_usd = excluded.fees_usd,
    pnl_1d_usd = excluded.pnl_1d_usd,
    pnl_1d_sol = excluded.pnl_1d_sol,
    fees_1d_usd = excluded.fees_1d_usd,
    pnl_7d_usd = excluded.pnl_7d_usd,
    pnl_7d_sol = excluded.pnl_7d_sol,
    fees_7d_usd = excluded.fees_7d_usd,
    deposited_usd = excluded.deposited_usd,
    withdrawn_usd = excluded.withdrawn_usd,
    current_value_usd = excluded.current_value_usd,
    created_at = excluded.created_at,
    closed_at = excluded.closed_at,
    duration_seconds = excluded.duration_seconds,
    bin_range = excluded.bin_range,
    setup_json = excluded.setup_json,
    last_updated = excluded.last_updated
`);

export const insertWalletBatch = db.transaction((items) => {
  for (const item of items) {
    if (!isSuspectPnlRow(item)) upsertWalletPnlStmt.run(cleanWalletPnlItem(item));
  }
});

export const batchUpsertWalletPnl = insertWalletBatch;

export const insertWalletPoolBatch = db.transaction((items) => {
  for (const item of items) {
    const row = { has_open: 0, created_at: null, ...item };
    if (!isSuspectPnlRow(row)) upsertWalletPoolPnlStmt.run(cleanWalletPnlItem(row));
  }
});

export function upsertPool(pool) {
  upsertPoolStmt.run(pool);
}

export function getAllPools(limit = 50) {
  return db.prepare('SELECT * FROM pools ORDER BY tvl_usd DESC LIMIT ?').all(limit);
}

export function getPoolByAddress(address) {
  return db.prepare('SELECT * FROM pools WHERE address = ?').get(address) || null;
}

export function upsertWalletPnl(data) {
  if (isSuspectPnlRow(data)) return;
  upsertWalletPnlStmt.run(cleanWalletPnlItem(data));
}

export function upsertWalletPoolPnl(data) {
  const row = { has_open: 0, created_at: null, ...data };
  if (isSuspectPnlRow(row)) return;
  upsertWalletPoolPnlStmt.run(cleanWalletPnlItem(row));
}

export function upsertWalletPosition(data) {
  if (!data.position_address || !data.wallet) return;
  const row = cleanWalletPosition({
    pool_name: null,
    status: 'closed',
    pnl_usd: 0,
    pnl_sol: 0,
    fees_usd: 0,
    pnl_1d_usd: 0,
    pnl_1d_sol: 0,
    fees_1d_usd: 0,
    pnl_7d_usd: 0,
    pnl_7d_sol: 0,
    fees_7d_usd: 0,
    deposited_usd: 0,
    withdrawn_usd: 0,
    current_value_usd: 0,
    created_at: null,
    closed_at: null,
    duration_seconds: null,
    bin_range: null,
    setup_json: '[]',
    last_updated: Date.now(),
    ...data,
  });
  if (!isReasonableUsd(row.pnl_usd) || !isReasonableUsd(row.fees_usd)) return;
  upsertWalletPositionStmt.run(row);
}

export function getLeaderboard({ mode = 'winners', limit = 50, offset = 0, pool = null, period = '7' }) {
  const direction = mode === 'losers' ? 'ASC' : 'DESC';
  const requestedDays = Number.parseInt(String(period).replace(/d$/i, ''), 10);
  const days = requestedDays === 1 ? 1 : 7;
  const poolFilter = pool ? 'AND pool_address = ?' : '';
  const pnlColumn = days === 1 ? 'pnl_1d_usd' : 'pnl_7d_usd';
  const pnlSolColumn = days === 1 ? 'pnl_1d_sol' : 'pnl_7d_sol';
  const feesColumn = days === 1 ? 'fees_1d_usd' : 'fees_7d_usd';
  const queryArgs = pool ? [pool] : [];
  const rows = db.prepare(`
    SELECT
      wallet,
      pool_address,
      COALESCE(MAX(pool_name), pool_address) AS pool_name,
      SUM(${pnlColumn}) AS pnl_usd,
      SUM(${pnlSolColumn}) AS pnl_sol,
      SUM(${feesColumn}) AS fees_earned_usd,
      SUM(deposited_usd) AS deposited_usd,
      SUM(withdrawn_usd) AS withdrawn_usd,
      COUNT(*) AS position_count,
      SUM(CASE WHEN ${pnlColumn} >= ${MIN_RANKED_PNL_USD} THEN 1 ELSE 0 END) AS winning_position_count,
      MAX(last_updated) AS last_updated
    FROM wallet_positions
    WHERE 1 = 1
    ${poolFilter}
      AND (ABS(${pnlColumn}) >= ${MIN_RANKED_PNL_USD} OR ABS(${feesColumn}) >= ${MIN_RANKED_PNL_USD})
    GROUP BY wallet, pool_address
  `).all(...queryArgs);

  const grouped = new Map();
  const addRows = (sourceRows) => {
    for (const row of sourceRows) {
    if (isSuspectPnlRow(row)) continue;
    const existing = grouped.get(row.wallet) || {
      wallet: row.wallet,
      pnl_usd: 0,
      pnl_sol: 0,
      fees_earned_usd: 0,
      deposited_usd: 0,
      withdrawn_usd: 0,
      position_count: 0,
      winning_position_count: 0,
      pool_count: 0,
      best_pool_name: row.pool_name,
      best_pool_address: row.pool_address,
      best_pool_pnl_usd: Number.NEGATIVE_INFINITY,
      last_updated: 0,
    };
    existing.pnl_usd += row.pnl_usd || 0;
    existing.pnl_sol += row.pnl_sol || 0;
    existing.fees_earned_usd += row.fees_earned_usd || 0;
    existing.deposited_usd += row.deposited_usd || 0;
    existing.withdrawn_usd += row.withdrawn_usd || 0;
    existing.position_count += row.position_count || 0;
    existing.winning_position_count += row.winning_position_count || 0;
    existing.pool_count += 1;
    existing.last_updated = Math.max(existing.last_updated || 0, row.last_updated || 0);
    if ((row.pnl_usd || 0) > existing.best_pool_pnl_usd) {
      existing.best_pool_pnl_usd = row.pnl_usd || 0;
      existing.best_pool_name = row.pool_name || row.pool_address;
      existing.best_pool_address = row.pool_address;
    }
    grouped.set(row.wallet, existing);
    }
  };

  addRows(rows);

  let usedStaleFallback = false;
  let periodSource = days === 1 ? 'wallet_positions_1d_period' : 'wallet_positions_7d_period';
  if (grouped.size === 0 && String(period).toLowerCase() === 'latest') {
    const fallbackRows = db.prepare(`
      SELECT
        wallet,
        pool_address,
        pool_name,
        pnl_usd,
        pnl_sol,
        fees_earned_usd,
        deposited_usd,
        withdrawn_usd,
        position_count,
        NULL AS winning_position_count,
        last_updated
      FROM wallet_pool_pnl
      WHERE (? IS NULL OR pool_address = ?)
    `).all(pool, pool);
    addRows(fallbackRows);
    usedStaleFallback = grouped.size > 0;
    periodSource = usedStaleFallback ? 'wallet_pool_pnl_stale_fallback' : 'wallet_positions';
  }

  const rankedRows = Array.from(grouped.values()).filter((row) => (
    mode === 'losers'
      ? (row.pnl_usd || 0) <= -MIN_RANKED_PNL_USD
      : (row.pnl_usd || 0) >= MIN_RANKED_PNL_USD
  ));

  const sorted = rankedRows.sort((left, right) => (
    direction === 'ASC' ? left.pnl_usd - right.pnl_usd : right.pnl_usd - left.pnl_usd
  ));
  return { rows: sorted.slice(offset, offset + limit), total: sorted.length, usedStaleFallback, periodSource };
}

export function getWalletSummary(wallet) {
  const row = db.prepare('SELECT * FROM wallet_pnl WHERE wallet = ?').get(wallet) || null;
  if (!row) return null;
  return isSuspectPnlRow(row) ? cleanWalletPnlItem(row) : row;
}

export function getWalletPoolBreakdown(wallet) {
  return db.prepare('SELECT * FROM wallet_pool_pnl WHERE wallet = ? ORDER BY pnl_usd DESC')
    .all(wallet)
    .filter((row) => !isSuspectPnlRow(row));
}

export function getWalletPositions(wallet) {
  return db.prepare('SELECT * FROM wallet_positions WHERE wallet = ? ORDER BY status DESC, created_at DESC')
    .all(wallet)
    .filter((row) => isReasonableUsd(row.pnl_usd) && isReasonableUsd(row.fees_usd));
}

export function startIndexRun() {
  const result = db.prepare('INSERT INTO index_runs (started_at, status) VALUES (?, ?)').run(Date.now(), 'running');
  return Number(result.lastInsertRowid);
}

export function finishIndexRun(id, data) {
  db.prepare(`
    UPDATE index_runs
    SET finished_at = ?, pools_indexed = ?, wallets_found = ?, positions_processed = ?,
        status = ?, error_message = ?
    WHERE id = ?
  `).run(
    Date.now(),
    data.pools_indexed || 0,
    data.wallets_found || 0,
    data.positions_processed || 0,
    data.status,
    data.error_message || null,
    id,
  );
}

export function markInterruptedIndexRuns() {
  db.prepare(`
    UPDATE index_runs
    SET finished_at = ?,
        status = 'interrupted',
        error_message = COALESCE(error_message, 'Process restarted before index finished')
    WHERE status = 'running'
      AND finished_at IS NULL
  `).run(Date.now());
}

export function getLastIndexRun() {
  return db.prepare('SELECT * FROM index_runs ORDER BY id DESC LIMIT 1').get() || null;
}

export function getIndexRunById(id) {
  return db.prepare('SELECT * FROM index_runs WHERE id = ?').get(id) || null;
}

export function getStats() {
  const walletCount = db.prepare('SELECT COUNT(*) AS count FROM wallet_pnl').get().count;
  const poolCount = db.prepare('SELECT COUNT(*) AS count FROM pools').get().count;
  const positionCount = db.prepare('SELECT COALESCE(SUM(position_count), 0) AS count FROM wallet_pool_pnl').get().count;
  return { walletCount, poolCount, positionCount, lastRun: getLastIndexRun() };
}

export const resetIndexedData = db.transaction(() => {
  db.prepare('DELETE FROM pools').run();
  db.prepare('DELETE FROM wallet_pnl').run();
  db.prepare('DELETE FROM wallet_pool_pnl').run();
  db.prepare('DELETE FROM wallet_positions').run();
  db.prepare('DELETE FROM index_runs').run();
});
