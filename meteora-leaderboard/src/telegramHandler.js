import { Bot } from 'grammy';
import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { config } from './config.js';
import { getSolPrice } from './api/jupiterPrice.js';
import { isValidAddress } from './api/meteoraClient.js';
import { getLeaderboard } from './core/leaderboard.js';
import { getWalletPortfolio } from './core/walletPortfolio.js';
import {
  formatError,
  formatHelp,
  formatLeaderboard,
  formatWalletPortfolio,
  splitTelegramMessage,
} from './formatters/telegramFormatter.js';

const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PERIODS = new Set(['7', '7d', '30', '30d', '90', '90d', 'all']);

export function parseTelegramArgs(text = '') {
  const tokens = String(text)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const result = {
    mode: 'winners',
    period: config.defaultPeriod,
    pool: null,
    wallet: null,
  };

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (normalized === 'losers' || normalized === 'loss' || normalized === 'bottom') {
      result.mode = 'losers';
    } else if (normalized === 'winners' || normalized === 'winner' || normalized === 'top') {
      result.mode = 'winners';
    } else if (PERIODS.has(normalized)) {
      result.period = normalized.replace('d', '');
    } else if (ADDRESS_RE.test(token)) {
      result.pool = token;
      result.wallet = token;
    }
  }

  return result;
}

function commandArgs(ctx) {
  return String(ctx.message?.text || '').replace(/^\/[a-zA-Z0-9_]+(@[a-zA-Z0-9_]+)?\s*/, '');
}

function requireAddress(value, label) {
  if (!value || !isValidAddress(value)) {
    throw new Error(`Missing or invalid ${label} address.`);
  }
  return value;
}

async function sendHtml(ctx, placeholder, html) {
  const chunks = splitTelegramMessage(html);
  const first = chunks[0] || formatError('Empty response');

  try {
    await ctx.api.editMessageText(ctx.chat.id, placeholder.message_id, first, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Failed to edit Telegram message:', error instanceof Error ? error.message : error);
    await ctx.reply(first.slice(0, 3900), { parse_mode: 'HTML' });
  }

  for (const chunk of chunks.slice(1)) {
    try {
      await ctx.reply(chunk, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('Failed to send Telegram chunk:', error instanceof Error ? error.message : error);
      await ctx.reply(`${chunk.slice(0, 3800)}\n\n<i>Message truncated.</i>`, { parse_mode: 'HTML' });
    }
  }
}

async function handleWithPlaceholder(ctx, handler) {
  const placeholder = await ctx.reply('⏳ Fetching data...', { parse_mode: 'HTML' });
  try {
    const html = await handler();
    await sendHtml(ctx, placeholder, html);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sendHtml(ctx, placeholder, formatError(message));
  }
}

export function createBot(token = config.telegramToken) {
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required to start the bot');
  }

  const bot = new Bot(token);

  bot.use(async (ctx, next) => {
    if (config.allowedTelegramIds.length === 0) {
      await next();
      return;
    }

    const userId = ctx.from?.id;
    if (!userId || !config.allowedTelegramIds.includes(userId)) {
      await ctx.reply('⛔ Akses ditolak.');
      return;
    }

    await next();
  });

  bot.command('ping', async (ctx) => {
    await ctx.reply('Pong! 🏓');
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(formatHelp(), { parse_mode: 'HTML' });
  });

  bot.command('leaderboard', async (ctx) => {
    await handleWithPlaceholder(ctx, async () => {
      const args = parseTelegramArgs(commandArgs(ctx));
      const [solPrice, rows] = await Promise.all([
        getSolPrice(),
        getLeaderboard({
          mode: args.mode,
          period: args.period,
          limit: config.defaultLimit,
        }),
      ]);
      return formatLeaderboard(rows, {
        mode: args.mode,
        period: args.period,
      }, solPrice);
    });
  });

  bot.command('pool', async (ctx) => {
    await handleWithPlaceholder(ctx, async () => {
      const args = parseTelegramArgs(commandArgs(ctx));
      const pool = requireAddress(args.pool, 'pool');
      const [solPrice, rows] = await Promise.all([
        getSolPrice(),
        getLeaderboard({
          pool,
          mode: args.mode,
          period: args.period,
          limit: config.defaultLimit,
        }),
      ]);
      return formatLeaderboard(rows, {
        pool,
        mode: args.mode,
        period: args.period,
      }, solPrice);
    });
  });

  bot.command('wallet', async (ctx) => {
    await handleWithPlaceholder(ctx, async () => {
      const args = parseTelegramArgs(commandArgs(ctx));
      const wallet = requireAddress(args.wallet, 'wallet');
      const [solPrice, portfolio] = await Promise.all([
        getSolPrice(),
        getWalletPortfolio(wallet),
      ]);
      return formatWalletPortfolio(portfolio, solPrice);
    });
  });

  bot.on('message:text', async (ctx) => {
    await ctx.reply(formatHelp(), { parse_mode: 'HTML' });
  });

  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  return bot;
}

export async function startBot() {
  const bot = createBot();

  const shutdown = (signal) => {
    console.log(`Received ${signal}, stopping bot...`);
    bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log('🤖 Meteora Leaderboard Bot started');
  console.log('   Mode: polling');
  console.log('   Allowed users:', config.allowedTelegramIds.length || 'ALL');

  await bot.start();
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    await startBot();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
