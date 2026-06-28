# Meteora DLMM LP Leaderboard

Standalone Node.js web dashboard and CLI for building a Meteora DLMM LP leaderboard from pool positions. It does not use the old global `/leaderboard` endpoint because that endpoint is no longer publicly available.

## How PnL Is Computed

The tool fetches active positions for a pool, then fetches deposits, withdraws, and current position state for each position. PnL is computed per position and aggregated by wallet:

```text
PnL = total_value_withdrawn - total_value_deposited + current_position_value + unclaimed_fees
```

Historical deposit and withdraw conversion uses Meteora position history USD fields when available. Current position value and unclaimed fees are decoded on-chain with the Meteora DLMM SDK, then converted to USD with Jupiter prices or Meteora pool token prices as fallback.

## Requirements

- Node.js 20+
- PM2 for keeping the web dashboard online

## Installation

```bash
npm install
cp .env.example .env
```

Edit `.env` if you want to override the default pool, concurrency, or RPC endpoint.

## Web Dashboard

```bash
npm start
```

Default URL:

```text
http://localhost:7777
```

PM2 deployment:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

## CLI Usage

```bash
node src/cli.js
node src/cli.js --losers
node src/cli.js --pool 5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6
node src/cli.js --pools addr1,addr2 --limit 50
node src/cli.js --search "SOL-USDC"
node src/cli.js --top-pools
node src/cli.js --json > output.json
```

Supported options:

```text
--pool <address>         Pool address
--pools <addr,addr,...>  Multiple pool addresses
--mode winners|losers    Sort order
--losers                 Shortcut for --mode losers
--limit <number>         Max positions to scan
--top-pools              Show top pools by volume
--search <query>         Search pool by name, symbol, mint, or address
--json                   Output JSON
--no-cache               Clear in-memory cache before run
--help                   Show help
```

## API Endpoints Used

Meteora data requests use:

```text
https://dlmm.datapi.meteora.ag
```

Endpoints:

```text
GET /pools?page=1&page_size=50
GET /pools/{pool_address}
GET /positions/{position_address}/historical
POST Solana RPC getProgramAccounts for DLMM position discovery
Meteora DLMM SDK getPosition for live LP value
```

Token prices use:

```text
GET https://api.jup.ag/price/v3?ids={mintAddress},{mintAddress2}
```

## Known Limitations

- Historical PnL for non-stable pairs may be approximate when the event data does not include enough USD context.
- Position discovery uses Solana RPC account filters because the public pool positions REST endpoint currently returns 404.
- Meteora rate limit is around 30 RPS. Keep `CONCURRENCY` between 3 and 8 for regular use.
- Very large pools can take time to compute. Use `--limit 50` for faster scans.

## Troubleshooting

```text
404 / not found      Pool or position address is wrong or unavailable.
Rate limit / 429     Lower CONCURRENCY in .env.
Timeout              Retry, lower --limit, or increase request timeout in src/config.js.
Empty prices         Jupiter price API failed; PnL may show zeros for unknown token prices.
```
