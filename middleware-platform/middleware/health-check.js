/**
 * Comprehensive Health Check Middleware
 * Monitors system health and provides detailed status.
 * Section 19: Dependency probes for Stedi, Groq, FHIR (30s cache, timeouts).
 */

const db = require('../database');
const os = require('os');
const axios = require('axios');

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

// Dependency probe cache (Section 19.1: 30s cache)
const DEPENDENCY_CACHE_MS = 30000;
let dependencyCache = { lastCheck: 0, result: null };

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

  // In some sandbox / constrained runtimes, V8 heapTotal can be unusually small.
  // In that case, percent-based thresholds can incorrectly flag the service as critical
  // even though absolute heap usage is still low.
  const HEAP_TOTAL_PERCENT_MODE_THRESHOLD_MB = parseFloat(process.env.HEALTH_HEAP_TOTAL_FOR_PERCENT_MODE_MB || '100');
  const HEAP_USED_WARNING_MB = parseFloat(process.env.HEALTH_HEAP_USED_WARNING_MB || '200');
  const HEAP_USED_CRITICAL_MB = parseFloat(process.env.HEALTH_HEAP_USED_CRITICAL_MB || '300');

  const status = heapTotalMB < HEAP_TOTAL_PERCENT_MODE_THRESHOLD_MB
    ? (heapUsedMB > HEAP_USED_CRITICAL_MB ? 'critical' : heapUsedMB > HEAP_USED_WARNING_MB ? 'warning' : 'healthy')
    : (heapUsagePercent > 90 ? 'critical' : heapUsagePercent > 75 ? 'warning' : 'healthy');

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
 * Check Stedi API reachability (2s timeout)
 */
async function checkStedi() {
  const base = process.env.STEDI_API_BASE || 'https://core.us.stedi.com';
  const key = process.env.STEDI_API_KEY;
  if (!key) return { status: 'not_configured', latencyMs: null };
  const start = Date.now();
  try {
    const res = await axios.get(`${base}/`, {
      timeout: 2000,
      validateStatus: () => true,
      headers: { Authorization: `Bearer ${key}` }
    });
    return { status: res.status < 500 ? 'healthy' : 'unhealthy', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'unhealthy', latencyMs: Date.now() - start, error: err.message };
  }
}

/**
 * Check Groq API reachability (3s timeout) — minimal 1-token probe
 */
async function checkGroq() {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { status: 'not_configured', latencyMs: null };
  const start = Date.now();
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: '1' }], max_tokens: 1 },
      { timeout: 3000, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    return { status: res.status === 200 ? 'healthy' : 'unhealthy', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'unhealthy', latencyMs: Date.now() - start, error: err.message };
  }
}

/**
 * Check FHIR metadata endpoint (2s timeout) — Epic or UHC if configured
 */
async function checkFhir() {
  const epicBase = process.env.EPIC_SANDBOX_BASE_URL || process.env.EPIC_PRODUCTION_BASE_URL;
  const uhcBase = process.env.UHC_FHIR_BASE;
  const base = epicBase || uhcBase;
  if (!base) return { status: 'not_configured', latencyMs: null };
  const start = Date.now();
  try {
    const url = base.includes('epic') ? `${base}/api/FHIR/R4/metadata` : `${base}/metadata`;
    const res = await axios.get(url, { timeout: 2000, validateStatus: () => true });
    return { status: res.status < 500 ? 'healthy' : 'unhealthy', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'unhealthy', latencyMs: Date.now() - start, error: err.message };
  }
}

/**
 * Run dependency probes (Section 19.1): Stedi, Groq, FHIR. Cached 30s.
 */
async function checkDependencies() {
  const now = Date.now();
  if (dependencyCache.result && now - dependencyCache.lastCheck < DEPENDENCY_CACHE_MS) {
    return dependencyCache.result;
  }
  const [stedi, groq, fhir] = await Promise.allSettled([
    checkStedi(),
    checkGroq(),
    checkFhir()
  ]);
  let circuitBreakers = {};
  try {
    const cb = require('../utils/circuit-breaker');
    if (typeof cb.getMetrics === 'function') circuitBreakers = cb.getMetrics();
  } catch (_) { /* ignore */ }
  const result = {
    stedi: stedi.status === 'fulfilled' ? stedi.value : { status: 'error', error: stedi.reason?.message },
    groq: groq.status === 'fulfilled' ? groq.value : { status: 'error', error: groq.reason?.message },
    fhir: fhir.status === 'fulfilled' ? fhir.value : { status: 'error', error: fhir.reason?.message },
    circuit_breaker_states: circuitBreakers.circuit_breaker_states || circuitBreakers
  };
  dependencyCache = { lastCheck: now, result };
  return result;
}

/**
 * Check voice Redis (required when VOICE_RATE_LIMIT_BACKEND=redis in production).
 */
async function checkVoiceRedis() {
  try {
    const voiceRedis = require('../utils/voice-redis-client');
    const required = voiceRedis.isRedisBackendRequired();
    if (!required && !voiceRedis.isRedisConfigured()) {
      return { status: 'skipped', required: false, configured: false };
    }
    if (required && !voiceRedis.isRedisConfigured()) {
      return { status: 'unhealthy', required: true, configured: false, error: 'REDIS_URL missing' };
    }
    const ping = await voiceRedis.ping();
    return {
      status: ping.ok ? 'healthy' : 'unhealthy',
      required,
      configured: ping.configured,
      latencyMs: ping.latencyMs,
      error: ping.error || null
    };
  } catch (err) {
    return { status: 'unhealthy', error: err.message };
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

  // Determine overall status (Section 19.1: DB critical; Stedi down = degraded, not unhealthy)
  const dbUnhealthy = !checks.database.healthy;
  const hasUnhealthy = dbUnhealthy || (checks.memory?.status === 'critical');
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
  const showDbPath = req.query.show_db_path === '1' || req.query.show_db_path === 'true';

  if (detailed) {
    const [fullHealth, dependencies, voiceRedis] = await Promise.all([
      performHealthCheck(),
      checkDependencies(),
      checkVoiceRedis()
    ]);
    let langsmith = { enabled: false, project: 'unknown', hasKey: false };
    try {
      const medicalCoding = require('../services/medical-coding-service');
      if (typeof medicalCoding.getLangSmithStatus === 'function') {
        langsmith = medicalCoding.getLangSmithStatus();
      }
    } catch (e) {
      langsmith.error = e.message;
    }
    // Override status to degraded if DB ok but deps unhealthy (Section 19.1)
    let status = fullHealth.status;
    if (status === 'healthy' && (dependencies.stedi?.status === 'unhealthy' || dependencies.groq?.status === 'unhealthy')) {
      status = 'degraded';
    }
    // P0: Degrade in production when LangSmith tracing disabled (Section 25)
    if (status === 'healthy' && process.env.NODE_ENV === 'production' && langsmith && !langsmith.enabled) {
      status = 'degraded';
      langsmith.warning = 'Production should have LangSmith tracing enabled for LLM traceability';
    }
    if (status === 'healthy' && voiceRedis?.required && voiceRedis.status === 'unhealthy') {
      status = 'unhealthy';
    } else if (status === 'healthy' && voiceRedis?.status === 'unhealthy') {
      status = 'degraded';
    }
    let colab_export = { loaded: false };
    try {
      const ks = require('../services/knowledge-service');
      if (typeof ks.getExportStats === 'function') colab_export = ks.getExportStats();
    } catch (e) { colab_export.error = e.message; }
    return res.json({
      success: true,
      ...fullHealth,
      status,
      dependencies,
      voice_redis: voiceRedis,
      colab_export,
      metrics: healthMetrics,
      langsmith,
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
  
  const sqlitePath =
    showDbPath && db?.db && typeof db.db.name === 'string' ? db.db.name : undefined;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'unhealthy',
    timestamp: new Date().toISOString(),
    service: 'middleware-platform',
    ...(sqlitePath ? { database_path: sqlitePath, db_path: sqlitePath } : {}),
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


