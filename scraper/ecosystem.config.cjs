// PM2 process file (VPS path). Use: `pm2 start ecosystem.config.cjs`.
// This is .cjs because the package is ESM ("type":"module"); PM2 ecosystem
// files are CommonJS.
module.exports = {
  apps: [
    {
      name: "testi-scraper",
      script: "./supervisor.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 5,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
      env_file: ".env",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/scraper-error.log",
      out_file: "./logs/scraper-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
