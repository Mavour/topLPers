module.exports = {
  apps: [{
    name: 'meteora-leaderboard-web',
    script: 'src/server.js',
    interpreter: 'node',
    env: {
      NODE_ENV: 'production',
      PORT: 7777,
    },
    restart_delay: 5000,
    max_restarts: 10,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
