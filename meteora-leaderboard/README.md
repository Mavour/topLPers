# Meteora DLMM LP Leaderboard

Responsive web dashboard for querying Meteora DLMM LP leaderboards and wallet portfolio summaries. The app is served by a standalone Node.js server and works on desktop and mobile browsers.

The leaderboard endpoints originally requested for Meteora currently return `404` from Meteora, so the UI surfaces that error instead of fabricating data. Wallet portfolio endpoints from the current official Meteora DLMM Data API are wired and verified.

## Installation

```bash
cd meteora-leaderboard
npm install
cp .env.example .env
```

Requires Node.js 20+.

## Configuration

Edit `.env`:

```dotenv
PORT=3000
HELIUS_API_KEY=your_helius_key_here
DEFAULT_PERIOD=7
DEFAULT_LIMIT=20
CACHE_TTL_SECONDS=300
```

`SOL_PRICE_OVERRIDE=150` can be set when Jupiter is unavailable or you want deterministic output.

## Run The Website

```bash
npm start
```

Open:

```text
http://localhost:3000
```

The page includes:

- Leaderboard unavailable notice when Meteora public leaderboard endpoints return 404
- Wallet portfolio lookup
- Responsive desktop table and mobile card-style rows

## API Routes

```text
GET /api/health
GET /api/leaderboard?mode=winners&period=7&limit=20
GET /api/leaderboard?mode=losers&period=30&limit=10&pool=<poolAddress>
GET /api/wallet?address=<walletAddress>
```

All API routes return JSON. Errors are returned as:

```json
{
  "error": "message"
}
```

## CLI

The CLI remains available for local diagnostics:

```bash
npm run cli -- --help
npm run cli -- --wallet 11111111111111111111111111111111 --json
```

## PM2 Deployment

```bash
cd meteora-leaderboard
pm2 start ecosystem.config.cjs
pm2 logs meteora-leaderboard-web
pm2 save
```

Set `PORT` in the PM2 environment or `.env` if you do not want port `3000`.

## Verification

```bash
npm run test:api
node --check src/server.js
npm start
```

`scripts/test-api.js` checks:

- 3 prompt-specified global leaderboard URL variants
- 4 prompt-specified pool leaderboard URL variants
- 3 current official wallet portfolio URL variants
- 3 legacy wallet portfolio URL variants
- Jupiter SOL price API

## API Endpoints Reference

Global leaderboard:

```text
https://dlmm.datapi.meteora.ag/leaderboard?period={period}&page=0&limit={limit}
https://dlmm.datapi.meteora.ag/portfolio/leaderboard?period={period}&limit={limit}
https://dlmm-api.meteora.ag/position/leaderboard?period={period}&page=0&limit={limit}
```

Pool leaderboard:

```text
https://dlmm.datapi.meteora.ag/pool/{poolAddress}/positions?page=0&limit={limit}
https://dlmm.datapi.meteora.ag/position/pool_position_pnl/{poolAddress}?page=0&limit={limit}
https://dlmm-api.meteora.ag/pair/{poolAddress}/positions?page=0&limit={limit}
https://dlmm-api.meteora.ag/position/pool_position_pnl/{poolAddress}?page=0&limit={limit}
```

Wallet portfolio:

```text
https://dlmm.datapi.meteora.ag/portfolio/open?user={walletAddress}&page=1&page_size=50
https://dlmm.datapi.meteora.ag/portfolio?user={walletAddress}&page=1&page_size=50
https://dlmm.datapi.meteora.ag/portfolio/total?user={walletAddress}
https://dlmm.datapi.meteora.ag/portfolio/{walletAddress}
https://dlmm.datapi.meteora.ag/user/{walletAddress}/portfolio
https://dlmm-api.meteora.ag/position/user_positions/{walletAddress}
```

Jupiter price:

```text
https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112
https://price.jup.ag/v6/price?ids=So11111111111111111111111111111111111111112
```

## Troubleshooting

`Leaderboard endpoints return 404`: The prompt-specified global and pool leaderboard URLs are kept in the client, but current Meteora responses return 404. Do not invent replacement leaderboard data without a verified endpoint.

`AbortError`: The endpoint timed out. Meteora calls retry three times and fall back to other URLs.

`429` or rate limit: Increase `CACHE_TTL_SECONDS`, reduce request frequency, or add upstream caching.

`No rows returned`: The endpoint may be live but using an unexpected schema. Inspect `scripts/test-api.js` output and extend `normalizeRows()` aliases in `src/api/meteoraClient.js`.
