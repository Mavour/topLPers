# Meteora DLMM LP Leaderboard

Standalone Node.js tool for querying Meteora DLMM LP winners, losers, pool leaderboards, and wallet portfolio summaries from the command line or Telegram.

This tool protects capital by treating API data as unstable: every Meteora call uses timeout, retry, fallback endpoints, and defensive response normalization. It does not make pool-entry decisions and does not bypass the separate rug-check requirement for any LP deployment.

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
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
HELIUS_API_KEY=your_helius_key_here
DEFAULT_PERIOD=7
DEFAULT_LIMIT=20
ALLOWED_TELEGRAM_IDS=123456789,987654321
CACHE_TTL_SECONDS=300
```

`ALLOWED_TELEGRAM_IDS` can be blank for open access. `SOL_PRICE_OVERRIDE=150` can be set when Jupiter is unavailable or you want deterministic test output.

## CLI Usage

```bash
node src/cli.js --help
node src/cli.js
node src/cli.js --losers --period 30 --limit 10
node src/cli.js --pool ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq
node src/cli.js --wallet 11111111111111111111111111111111
node src/cli.js --json 2>/dev/null > output.json
```

Example terminal shape:

```text
Meteora DLMM LP Leaderboard v1.0.0
Fetching data... done

🏆 TOP LP WINNERS - Global (Last 7 days)
────────────────────────────────────────────────────────────────────────────────────────────────
#    Wallet            PnL SOL           PnL USD           Fees USD        Positions
────────────────────────────────────────────────────────────────────────────────────────────────
🥇   4tZ8Gm...EmNv    +12.3400 SOL      +$1.85K          +$210.00        3
🥈   9xQP7r...3vBn    +8.1200 SOL       +$1.22K          +$145.00        2
```

## Telegram Bot Setup

1. Create a bot with `@BotFather`.
2. Put the token in `.env` as `TELEGRAM_BOT_TOKEN`.
3. Optionally set `ALLOWED_TELEGRAM_IDS`.
4. Start polling:

```bash
npm run telegram
```

Commands:

```text
/leaderboard
/leaderboard losers
/leaderboard 30
/leaderboard losers 30
/leaderboard all
/pool <address>
/pool <address> losers
/pool <address> 30
/pool <address> losers 30
/wallet <address>
/help
/ping
```

## Integration Into Existing Bot

The standalone handler also exports reusable pieces:

```javascript
import { createBot, parseTelegramArgs } from './meteora-leaderboard/src/telegramHandler.js';
import { getLeaderboard } from './meteora-leaderboard/src/core/leaderboard.js';
import { formatLeaderboard } from './meteora-leaderboard/src/formatters/telegramFormatter.js';
```

For an existing `grammY` bot, copy the command bodies from `src/telegramHandler.js` or call `getLeaderboard()` and `formatLeaderboard()` directly. For `node-telegram-bot-api`, reuse the core and formatter modules, then send the returned HTML with `parse_mode: 'HTML'`.

## PM2 Deployment

```bash
cd meteora-leaderboard
pm2 start ecosystem.config.cjs
pm2 logs meteora-leaderboard-bot
pm2 save
```

The PM2 app runs `src/telegramHandler.js` in polling mode and restarts with a 5 second delay.

## Verification

```bash
npm run test:api
node src/cli.js --help
node src/cli.js --json
```

`scripts/test-api.js` checks:

- 3 global leaderboard URL variants
- 4 pool leaderboard URL variants
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

`Leaderboard endpoints return 404`: The prompt-specified global and pool leaderboard URLs are kept in the client, but as of the latest verification they return 404 from Meteora. Wallet portfolio endpoints documented in the current Meteora DLMM API are working. Do not invent replacement leaderboard data without a verified endpoint.

`HTTP 404/410`: Meteora has changed or removed an endpoint. Run `npm run test:api` and use the working fallback shown in logs.

`AbortError`: The endpoint timed out. The client retries Meteora calls three times and falls back to other URLs.

`429` or rate limit: Increase cache TTL with `CACHE_TTL_SECONDS`, reduce Telegram access, or put the bot behind an allowlist.

`Telegram message too long`: The formatter caps messages at 4000 characters and sends extra chunks when needed.

`No rows returned`: The endpoint may be live but using an unexpected schema. Inspect `scripts/test-api.js` output and extend `normalizeRows()` aliases in `src/api/meteoraClient.js`.
