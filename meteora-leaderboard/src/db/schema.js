import Database from 'better-sqlite3';
import { config } from '../config.js';

let db;

export function initDb() {
  if (db) return db;

  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS pools (
      address TEXT PRIMARY KEY,
      name TEXT,
      token_x_mint TEXT,
      token_y_mint TEXT,
      token_x_symbol TEXT,
      token_y_symbol TEXT,
      bin_step INTEGER,
      fee_rate REAL,
      tvl_usd REAL DEFAULT 0,
      volume_24h_usd REAL DEFAULT 0,
      last_indexed INTEGER,
      position_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS wallet_pnl (
      wallet TEXT PRIMARY KEY,
      pnl_usd REAL DEFAULT 0,
      pnl_sol REAL DEFAULT 0,
      fees_earned_usd REAL DEFAULT 0,
      deposited_usd REAL DEFAULT 0,
      withdrawn_usd REAL DEFAULT 0,
      position_count INTEGER DEFAULT 0,
      pool_count INTEGER DEFAULT 0,
      last_updated INTEGER
    );

    CREATE TABLE IF NOT EXISTS wallet_pool_pnl (
      wallet TEXT,
      pool_address TEXT,
      pool_name TEXT,
      pnl_usd REAL DEFAULT 0,
      pnl_sol REAL DEFAULT 0,
      fees_earned_usd REAL DEFAULT 0,
      deposited_usd REAL DEFAULT 0,
      withdrawn_usd REAL DEFAULT 0,
      position_count INTEGER DEFAULT 0,
      has_open INTEGER DEFAULT 0,
      created_at INTEGER,
      last_updated INTEGER,
      PRIMARY KEY (wallet, pool_address)
    );

    CREATE TABLE IF NOT EXISTS index_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER,
      finished_at INTEGER,
      pools_indexed INTEGER DEFAULT 0,
      wallets_found INTEGER DEFAULT 0,
      positions_processed INTEGER DEFAULT 0,
      status TEXT,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_wallet_pnl ON wallet_pnl(pnl_usd);
    CREATE INDEX IF NOT EXISTS idx_wallet_pool_wallet ON wallet_pool_pnl(wallet);
    CREATE INDEX IF NOT EXISTS idx_wallet_pool_pool ON wallet_pool_pnl(pool_address);
    CREATE INDEX IF NOT EXISTS idx_wallet_pool_pnl_updated ON wallet_pool_pnl(last_updated);
  `);

  try {
    db.prepare('ALTER TABLE wallet_pool_pnl ADD COLUMN has_open INTEGER DEFAULT 0').run();
  } catch {
    // Column already exists.
  }
  try {
    db.prepare('ALTER TABLE wallet_pool_pnl ADD COLUMN created_at INTEGER').run();
  } catch {
    // Column already exists.
  }

  return db;
}

export function getDb() {
  return db || initDb();
}
