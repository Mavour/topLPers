import { config } from '../src/config.js';
import { getSolPrice } from '../src/api/jupiterPrice.js';

const TEST_POOL = 'ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq';
const TEST_WALLET = '11111111111111111111111111111111';

const endpoints = [
  {
    group: 'Global leaderboard',
    url: `${config.datApiBase}/leaderboard?period=7d&page=0&limit=10`,
  },
  {
    group: 'Global leaderboard',
    url: `${config.datApiBase}/portfolio/leaderboard?period=7d&limit=10`,
  },
  {
    group: 'Global leaderboard',
    url: `${config.legacyApiBase}/position/leaderboard?period=7d&page=0&limit=10`,
  },
  {
    group: 'Pool leaderboard',
    url: `${config.datApiBase}/pool/${TEST_POOL}/positions?page=0&limit=10`,
  },
  {
    group: 'Pool leaderboard',
    url: `${config.datApiBase}/position/pool_position_pnl/${TEST_POOL}?page=0&limit=10`,
  },
  {
    group: 'Pool leaderboard',
    url: `${config.legacyApiBase}/pair/${TEST_POOL}/positions?page=0&limit=10`,
  },
  {
    group: 'Pool leaderboard',
    url: `${config.legacyApiBase}/position/pool_position_pnl/${TEST_POOL}?page=0&limit=10`,
  },
  {
    group: 'Wallet portfolio official',
    url: `${config.datApiBase}/portfolio/open?user=${TEST_WALLET}&page=1&page_size=5`,
  },
  {
    group: 'Wallet portfolio official',
    url: `${config.datApiBase}/portfolio?user=${TEST_WALLET}&page=1&page_size=5`,
  },
  {
    group: 'Wallet portfolio official',
    url: `${config.datApiBase}/portfolio/total?user=${TEST_WALLET}`,
  },
  {
    group: 'Wallet portfolio legacy',
    url: `${config.datApiBase}/portfolio/${TEST_WALLET}`,
  },
  {
    group: 'Wallet portfolio legacy',
    url: `${config.datApiBase}/user/${TEST_WALLET}/portfolio`,
  },
  {
    group: 'Wallet portfolio legacy',
    url: `${config.legacyApiBase}/position/user_positions/${TEST_WALLET}`,
  },
];

function describeSample(raw) {
  if (Array.isArray(raw)) {
    return `${raw.length} rows; first=${JSON.stringify(raw[0] ?? null).slice(0, 220)}`;
  }
  if (raw && typeof raw === 'object') {
    const keys = Object.keys(raw);
    const arrayKey = keys.find((key) => Array.isArray(raw[key]));
    if (arrayKey) {
      return `keys=${keys.slice(0, 8).join(',')}; ${arrayKey} rows=${raw[arrayKey].length}`;
    }
    return `keys=${keys.slice(0, 12).join(',')}`;
  }
  return String(raw).slice(0, 220);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    const elapsed = Date.now() - started;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        elapsed,
        reason: text.slice(0, 220),
      };
    }

    try {
      const raw = text ? JSON.parse(text) : null;
      return {
        ok: Boolean(raw),
        status: response.status,
        elapsed,
        sample: describeSample(raw),
      };
    } catch (error) {
      return {
        ok: false,
        status: response.status,
        elapsed,
        reason: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } catch (error) {
    return {
      ok: false,
      status: 'ERR',
      elapsed: Date.now() - started,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  let working = 0;
  const total = endpoints.length + 1;

  for (const endpoint of endpoints) {
    const result = await fetchJson(endpoint.url);
    const icon = result.ok ? '✅' : '❌';
    if (result.ok) {
      working += 1;
    }
    console.log(`${icon} [${endpoint.group}] ${endpoint.url}`);
    console.log(`   status=${result.status} time=${result.elapsed}ms`);
    console.log(`   ${result.ok ? result.sample : result.reason}`);
  }

  try {
    const price = await getSolPrice();
    working += 1;
    console.log(`✅ [Jupiter price] SOL price = $${price.toFixed(2)}`);
  } catch (error) {
    console.log(`❌ [Jupiter price] ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`\nSummary: ${working}/${total} endpoints working`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
