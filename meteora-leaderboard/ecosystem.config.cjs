module.exports = {
  apps: [{
    name: 'meteora-lb-bot',
    script: 'src/telegramBot.js',
    watch: false,
    restart_delay: 5000,
    max_restarts: 10,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    env: { NODE_ENV: 'production' },
  }],
};
