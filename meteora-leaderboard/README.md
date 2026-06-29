# Meteora DLMM LP Leaderboard V3

Self-indexed Meteora DLMM leaderboard. The backend crawls top Meteora pools, computes wallet PnL from position history, stores results in SQLite, and serves a zero-build frontend.

## Install

```bash
npm install
cp .env.example .env
```

Edit `.env` and set a random `ADMIN_TOKEN`.

## Run

```bash
node src/server.js
```

Open:

```text
http://localhost:3001
```

The first run starts automatically when the database is empty. It can take 10-30 minutes depending on `TOP_POOLS_LIMIT`, `MAX_POSITIONS_PER_POOL`, RPC speed, and Meteora rate limits.

## Manual Index

```bash
curl -X POST http://localhost:3001/api/index/run \
  -H "Authorization: Bearer your_admin_token"
```

## API

- `GET /api/status`
- `GET /api/pools`
- `GET /api/leaderboard?mode=winners&limit=50`
- `GET /api/leaderboard?mode=losers&pool=<poolAddress>`
- `GET /api/wallet/:address`
- `POST /api/index/run`

## PM2

```bash
pm2 start src/server.js --name meteora-lb
pm2 save
pm2 logs meteora-lb
```
