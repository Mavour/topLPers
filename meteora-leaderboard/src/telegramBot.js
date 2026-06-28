import 'dotenv/config';
import { Bot } from 'grammy';
import { config } from './config.js';
import { isValidAddress } from './api/meteoraApi.js';
import { buildPoolLeaderboard } from './core/leaderboard.js';
import { getTopPools, searchPool } from './core/poolScanner.js';
import {
  formatError,
  formatHelp,
  formatLeaderboard,
  formatPoolInfo,
  formatProgress,
} from './formatters/telegramFormatter.js';

if (!config.telegramToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is required to run the bot');
}

const bot = new Bot(config.telegramToken);

function parseBotArgs(text = '') {
  const parts = String(text).trim().split(/\s+/).filter(Boolean);
  const parsed = { pool: null, mode: 'winners' };

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'losers' || lower === 'winners') {
      parsed.mode = lower;
    } else if (isValidAddress(part)) {
      parsed.pool = part;
    }
  }

  return parsed;
}

function commandArgs(ctx) {
  const text = ctx.message?.text || '';
  return text.replace(/^\/[a-zA-Z_]+(@[a-zA-Z0-9_]+)?\s*/, '');
}

async function editOrReply(ctx, message, html) {
  if (html.length <= 4096) {
    await ctx.api.editMessageText(ctx.chat.id, message.message_id, html, { parse_mode: 'HTML' });
    return;
  }

  await ctx.api.editMessageText(ctx.chat.id, message.message_id, html.slice(0, 4000), { parse_mode: 'HTML' });
  await ctx.reply(html.slice(4000, 8000), { parse_mode: 'HTML' });
}

bot.use(async (ctx, next) => {
  if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(ctx.from?.id)) {
    await ctx.reply('Access denied.');
    return;
  }
  await next();
});

async function handleLeaderboard(ctx, requirePool = false) {
  const args = parseBotArgs(commandArgs(ctx));
  const pool = args.pool || config.defaultPool;

  if (requirePool && !args.pool) {
    await ctx.reply(formatError(new Error('Pool address is required.')), { parse_mode: 'HTML' });
    return;
  }

  const progress = await ctx.reply(formatProgress('Fetching leaderboard'), { parse_mode: 'HTML' });

  try {
    const result = await buildPoolLeaderboard(pool, {
      mode: args.mode,
      limit: config.maxPositions,
      concurrency: config.concurrency,
    });
    await editOrReply(ctx, progress, formatLeaderboard(result));
  } catch (error) {
    await editOrReply(ctx, progress, formatError(error));
  }
}

bot.command(['lb', 'leaderboard'], (ctx) => handleLeaderboard(ctx, false));
bot.command('pool', (ctx) => handleLeaderboard(ctx, true));

bot.command('pools', async (ctx) => {
  const progress = await ctx.reply(formatProgress('Fetching pools'), { parse_mode: 'HTML' });
  try {
    const pools = await getTopPools(10);
    const html = pools.map(formatPoolInfo).join('\n\n');
    await editOrReply(ctx, progress, html || 'No pools found.');
  } catch (error) {
    await editOrReply(ctx, progress, formatError(error));
  }
});

bot.command('search', async (ctx) => {
  const query = commandArgs(ctx).trim();
  if (!query) {
    await ctx.reply(formatError(new Error('Search query is required.')), { parse_mode: 'HTML' });
    return;
  }

  const progress = await ctx.reply(formatProgress('Searching pools'), { parse_mode: 'HTML' });
  try {
    const pools = await searchPool(query);
    const html = pools.slice(0, 5).map(formatPoolInfo).join('\n\n');
    await editOrReply(ctx, progress, html || 'No pools found.');
  } catch (error) {
    await editOrReply(ctx, progress, formatError(error));
  }
});

bot.command('help', (ctx) => ctx.reply(formatHelp(), { parse_mode: 'HTML' }));
bot.command('ping', (ctx) => ctx.reply('Pong! Bot is running.'));
bot.on('message', (ctx) => ctx.reply(formatHelp(), { parse_mode: 'HTML' }));

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error handling update ${ctx.update.update_id}:`, err.error);
});

console.log('Meteora Leaderboard Bot started');
console.log('   Default pool:', config.defaultPool);
console.log('   Allowed users:', config.allowedUserIds.length || 'ALL (open access)');

process.on('SIGINT', () => {
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  bot.stop();
  process.exit(0);
});

bot.start();
