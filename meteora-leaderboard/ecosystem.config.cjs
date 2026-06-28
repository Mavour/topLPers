module.exports = {
  apps: [
    {
      name: 'meteora-leaderboard-bot',
      script: 'src/telegramHandler.js',
      interpreter: 'node',
      interpreter_args: '--experimental-vm-modules',
      env: {
        NODE_ENV: 'production',
      },
      restart_delay: 5000,
      max_restarts: 10,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
