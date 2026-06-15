/**
 * PM2 ecosystem config for production deployment.
 * Usage:
 *   npm run build          # build Next.js
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup  # survive reboots
 */

module.exports = {
  apps: [
    {
      name: "nestiq-dashboard",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "512M",
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
    },
    {
      name: "nestiq-worker",
      script: "node_modules/.bin/tsx",
      args: "--env-file=.env src/worker.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "256M",
      restart_delay: 5000,
      exp_backoff_restart_delay: 200,
    },
  ],
};
