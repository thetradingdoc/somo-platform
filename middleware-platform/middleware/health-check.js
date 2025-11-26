/**
 * Comprehensive Health Check Middleware
 * Monitors system health and provides detailed status
 */

const db = require('../database');
const os = require('os');

let healthStatus = {
  status: 'healthy',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
  checks: {}
};

// Track health metrics
const healthMetrics = {
  database: { status: 'unknown', lastCheck: null, responseTime: null },
  memory: { status: 'unknown', usage: null },
  disk: { status: 'unknown', usage: null }
};

/**
 * Check database connectivity
 */
async function checkDatabase() {
  const start = Date.now();
  try {
    // Simple query to test database
    const result = db.db.prepare('SELECT 1 as test').get();
    const responseTime = Date.now() - start;
    
    healthMetrics.database = {
      status: result ? 'healthy' : 'degraded',
      lastCheck: new Date().toISOString(),
      responseTime
    };
    
    return { healthy: !!result, responseTime };
  } catch (error) {
    healthMetrics.database = {
      status: 'unhealthy',
      lastCheck: new Date().toISOString(),
      error: error.message
    };
    return { healthy: false, error: error.message };
  }
}

/**
 * Check memory usage
 */
function checkMemory() {
  const usage = process.memoryUsage();
  const heapUsedMB = usage.heapUsed / 1024 / 1024;
  const heapTotalMB = usage.heapTotal / 1024 / 1024;
  const rssMB = usage.rss / 1024 / 1024;
  const heapUsagePercent = (heapUsedMB / heapTotalMB) * 100;

  const status = heapUsagePercent > 90 ? 'critical' : 
                 heapUsagePercent > 75 ? 'warning' : 'healthy';

  healthMetrics.memory = {
    status,
    usage: {
      heapUsedMB: Math.round(heapUsedMB),
      heapTotalMB: Math.round(heapTotalMB),
      rssMB: Math.round(rssMB),
      heapUsagePercent: Math.round(heapUsagePercent)
    }
  };

  return { status, usage: healthMetrics.memory.usage };
}

/**
 * Check disk usage (if available)
 */
function checkDisk() {
  try {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const usagePercent = (usedMemory / totalMemory) * 100;

    const status = usagePercent > 90 ? 'critical' : 
                   usagePercent > 75 ? 'warning' : 'healthy';

    healthMetrics.disk = {
      status,
      usage: {
        totalGB: Math.round(totalMemory / 1024 / 1024 / 1024),
        freeGB: Math.round(freeMemory / 1024 / 1024 / 1024),
        usedGB: Math.round(usedMemory / 1024 / 1024 / 1024),
        usagePercent: Math.round(usagePercent)
      }
    };

    return { status, usage: healthMetrics.disk.usage };
  } catch (error) {
    return { status: 'unknown', error: error.message };
  }
}

/**
 * Comprehensive health check
 */
async function performHealthCheck() {
  const checks = {
    database: await checkDatabase(),
    memory: checkMemory(),
    disk: checkDisk(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };

  // Determine overall status
  const hasUnhealthy = Object.values(checks).some(
    check => check.status === 'unhealthy' || check.status === 'critical'
  );
  const hasWarning = Object.values(checks).some(
    check => check.status === 'warning'
  );

  const overallStatus = hasUnhealthy ? 'unhealthy' : 
                       hasWarning ? 'degraded' : 'healthy';

  healthStatus = {
    status: overallStatus,
    timestamp: checks.timestamp,
    uptime: checks.uptime,
    checks
  };

  return healthStatus;
}

/**
 * Health check endpoint handler
 */
async function healthCheckHandler(req, res) {
  const detailed = req.query.detailed === 'true' || req.query.detailed === '1';
  
  if (detailed) {
    const fullHealth = await performHealthCheck();
    return res.json({
      success: true,
      ...fullHealth,
      metrics: healthMetrics,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        env: process.env.NODE_ENV || 'development'
      }
    });
  }

  // Quick health check
  const dbCheck = await checkDatabase();
  const memoryCheck = checkMemory();
  
  const isHealthy = dbCheck.healthy && memoryCheck.status !== 'critical';
  
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'unhealthy',
    timestamp: new Date().toISOString(),
    service: 'middleware-platform',
    ...(isHealthy ? {} : { 
      issues: {
        database: !dbCheck.healthy ? 'Database connection failed' : null,
        memory: memoryCheck.status === 'critical' ? 'High memory usage' : null
      }
    })
  });
}

/**
 * Readiness check (for Kubernetes/Azure)
 */
async function readinessCheck(req, res) {
  const dbCheck = await checkDatabase();
  
  if (!dbCheck.healthy) {
    return res.status(503).json({
      ready: false,
      reason: 'Database not available'
    });
  }

  res.json({ ready: true });
}

/**
 * Liveness check (for Kubernetes/Azure)
 */
function livenessCheck(req, res) {
  // If the process is running and can respond, it's alive
  res.json({ alive: true });
}

// Perform initial health check
performHealthCheck().catch(err => {
  console.error('⚠️  Initial health check failed:', err.message);
});

// Update health status every 30 seconds
setInterval(() => {
  performHealthCheck().catch(err => {
    console.error('⚠️  Health check failed:', err.message);
  });
}, 30000);

module.exports = {
  healthCheckHandler,
  readinessCheck,
  livenessCheck,
  performHealthCheck,
  getHealthStatus: () => healthStatus,
  getHealthMetrics: () => healthMetrics
};


