import { getDb } from './schema.js';

const db = getDb();

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

export const insertWalletBatch = db.transaction((items) => {
  for (const item of items) upsertWalletPnlStmt.run(item);
});

export const batchUpsertWalletPnl = insertWalletBatch;

export const insertWalletPoolBatch = db.transaction((items) => {
  for (const item of items) upsertWalletPoolPnlStmt.run({ has_open: 0, created_at: null, ...item });
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
  upsertWalletPnlStmt.run(data);
}

export function upsertWalletPoolPnl(data) {
  upsertWalletPoolPnlStmt.run({ has_open: 0, created_at: null, ...data });
}

export function getLeaderboard({ mode = 'winners', limit = 50, offset = 0, pool = null, period = '7' }) {
  const direction = mode === 'losers' ? 'ASC' : 'DESC';
  const requestedDays = Number.parseInt(String(period).replace(/d$/i, ''), 10);
  const days = requestedDays === 1 ? 1 : 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = db.prepare(`
    SELECT * FROM wallet_pool_pnl
    WHERE last_updated >= ? ${pool ? 'AND pool_address = ?' : ''}
  `).all(...(pool ? [cutoff, pool] : [cutoff]));

  const grouped = new Map();
  for (const row of rows) {
    const existing = grouped.get(row.wallet) || {
      wallet: row.wallet,
      pnl_usd: 0,
      pnl_sol: 0,
      fees_earned_usd: 0,
      deposited_usd: 0,
      withdrawn_usd: 0,
      position_count: 0,
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
    existing.pool_count += 1;
    existing.last_updated = Math.max(existing.last_updated || 0, row.last_updated || 0);
    if ((row.pnl_usd || 0) > existing.best_pool_pnl_usd) {
      existing.best_pool_pnl_usd = row.pnl_usd || 0;
      existing.best_pool_name = row.pool_name || row.pool_address;
      existing.best_pool_address = row.pool_address;
    }
    grouped.set(row.wallet, existing);
  }

  const sorted = Array.from(grouped.values()).sort((left, right) => (
    direction === 'ASC' ? left.pnl_usd - right.pnl_usd : right.pnl_usd - left.pnl_usd
  ));
  return { rows: sorted.slice(offset, offset + limit), total: sorted.length };
}

export function getWalletSummary(wallet) {
  return db.prepare('SELECT * FROM wallet_pnl WHERE wallet = ?').get(wallet) || null;
}

export function getWalletPoolBreakdown(wallet) {
  return db.prepare('SELECT * FROM wallet_pool_pnl WHERE wallet = ? ORDER BY pnl_usd DESC').all(wallet);
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
