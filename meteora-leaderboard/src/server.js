import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { initDb } from './db/schema.js';
import { getStats, markInterruptedIndexRuns } from './db/queries.js';
import { runFullIndex, setupCron } from './indexer/indexRunner.js';
import leaderboardRouter from './routes/leaderboard.js';
import poolsRouter from './routes/pools.js';
import statusRouter from './routes/status.js';
import walletRouter from './routes/wallet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/pools', poolsRouter);
app.use('/api/status', statusRouter);

app.post('/api/index/run', (req, res) => {
  runFullIndex().catch((error) => console.error('Manual index error:', error));
  return res.json({ message: 'Index run triggered' });
});

app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

initDb();
try {
  markInterruptedIndexRuns();
} catch (error) {
  console.warn('[indexer] failed to mark interrupted runs:', error instanceof Error ? error.message : error);
}
setupCron();

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
  const { walletCount } = getStats();
  if (walletCount === 0 && process.env.AUTO_INDEX_ON_START !== '0') {
    console.log('Database kosong. Menjalankan initial index...');
    runFullIndex().catch((error) => console.error('Initial index error:', error));
  }
});
