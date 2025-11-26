/**
 * PM2 Ecosystem Configuration
 * Process manager for production reliability
 * Run: pm2 start ecosystem.config.js
 */

module.exports = {
  apps: [{
    name: 'doclittle-api',
    script: './middleware-platform/server.js',
    instances: 1, // Start with 1, can scale with PM2 cluster mode
    exec_mode: 'fork', // Use 'cluster' for multi-core scaling
    watch: false,
    max_memory_restart: '800M', // Restart if memory exceeds 800MB
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    merge_logs: true,
    autorestart: true,
    max_restarts: 10, // Max restarts in 1 minute
    min_uptime: '10s', // Min uptime to consider app stable
    restart_delay: 4000, // Wait 4s before restarting
    kill_timeout: 5000, // Wait 5s for graceful shutdown
    wait_ready: true, // Wait for app to be ready
    listen_timeout: 10000, // Wait 10s for app to listen
    shutdown_with_message: true,
    env: {
      NODE_ENV: 'production',
      PORT: 4000
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 4000,
      watch: true
    },
    // Health check configuration
    health_check_grace_period: 3000,
    health_check_fatal_exceptions: true
  }]
};


