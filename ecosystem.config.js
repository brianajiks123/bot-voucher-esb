module.exports = {
  apps: [
    {
      name: 'BOT-VOUCHER-ESB',
      script: 'index.js',
      watch: false,
      restart_delay: 5000,
      max_restarts: 10,
      env: { NODE_ENV: 'production' },
    },
  ],
};
