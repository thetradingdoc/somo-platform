# API Reliability & Crash Prevention

## Overview
This document outlines the comprehensive reliability measures implemented to ensure the API runs continuously without crashes, protecting businesses that depend on it.

## Protective Measures

### 1. Error Handling & Crash Prevention

#### Comprehensive Error Handler (`middleware/error-handler.js`)
- **Graceful Error Handling**: All errors are caught and handled without crashing
- **Error Rate Monitoring**: Circuit breaker pattern prevents cascading failures
- **Error Logging**: All errors logged to database and console
- **Timeout Protection**: Operations timeout after 30s to prevent hanging
- **Retry Logic**: Exponential backoff for transient failures
- **Memory Monitoring**: Automatic garbage collection and memory leak detection

#### Key Features:
```javascript
// Wraps async routes to catch errors
asyncHandler(routeHandler)

// Adds timeout protection
withTimeout(operation, 30000)

// Retries with exponential backoff
withRetry(operation, 3, 1000)
```

### 2. Process Management

#### PM2 Configuration (`ecosystem.config.js`)
- **Auto-restart**: Automatically restarts on crash
- **Memory limits**: Restarts if memory exceeds 800MB
- **Max restarts**: Limits restart attempts (10 per minute)
- **Graceful shutdown**: Waits for connections to close
- **Health checks**: Monitors app health

#### Usage:
```bash
# Start with PM2
pm2 start ecosystem.config.js

# Monitor
pm2 monit

# View logs
pm2 logs doclittle-api
```

### 3. Health Monitoring

#### Health Check Endpoints (`middleware/health-check.js`)
- **`/health`**: Quick health status
- **`/health?detailed=true`**: Comprehensive health metrics
- **`/health/ready`**: Readiness probe (for Kubernetes/Azure)
- **`/health/live`**: Liveness probe

#### Monitored Metrics:
- Database connectivity & response time
- Memory usage (heap, RSS)
- Disk usage
- Uptime
- Error rates

### 4. Azure App Service Reliability

#### Automatic Features:
- **Auto-restart**: Azure restarts app on failure
- **Health probes**: Azure monitors `/health` endpoint
- **Load balancing**: Distributes traffic across instances
- **Scaling**: Auto-scale based on load
- **Deployment slots**: Zero-downtime deployments

#### Configuration:
```bash
# Set health check path
az webapp config set --name doclittle --resource-group doclittle \
  --generic-configurations '{"healthCheckPath": "/health"}'

# Enable always on
az webapp config set --name doclittle --resource-group doclittle \
  --always-on true
```

### 5. Database Resilience

#### Connection Handling:
- **Connection pooling**: Better-sqlite3 handles connections efficiently
- **Error recovery**: Database errors don't crash the app
- **Retry logic**: Automatic retries for transient DB errors
- **Migration safety**: Schema migrations run safely on startup

### 6. Graceful Shutdown

#### Implementation:
- **SIGINT/SIGTERM handling**: Graceful shutdown on termination
- **Connection cleanup**: Closes HTTP, WebSocket, and DB connections
- **Timeout protection**: Forces shutdown after 30s if needed
- **In-flight request handling**: Allows requests to complete

### 7. Memory Leak Prevention

#### Measures:
- **Memory monitoring**: Checks every 5 minutes
- **Garbage collection**: Automatic GC when memory is high
- **Memory limits**: PM2 restarts at 800MB
- **Leak detection**: Warns when memory usage is high

### 8. Rate Limiting & Overload Protection

#### Existing Middleware:
- **API rate limiting**: Prevents API abuse
- **Auth rate limiting**: Protects authentication endpoints
- **Payment rate limiting**: Secures payment endpoints
- **Voice rate limiting**: Protects voice endpoints

### 9. Error Rate Circuit Breaker

#### Implementation:
- **Threshold**: 100 errors per minute
- **Auto-disable**: Temporarily disables endpoints on high error rate
- **Recovery**: Automatically recovers when error rate drops
- **Protection**: Prevents cascading failures

## Monitoring & Alerts

### Recommended Monitoring:
1. **Azure Application Insights**: Track errors, performance, dependencies
2. **Uptime monitoring**: External service (e.g., UptimeRobot)
3. **Error alerts**: Email/SMS on critical errors
4. **Performance monitoring**: Track response times

### Setup Application Insights:
```bash
az monitor app-insights component create \
  --app doclittle-insights \
  --location westus2 \
  --resource-group doclittle

az webapp config appsettings set \
  --name doclittle \
  --resource-group doclittle \
  --settings APPINSIGHTS_INSTRUMENTATIONKEY="<key>"
```

## Deployment Checklist

- [x] Comprehensive error handler implemented
- [x] Health check endpoints configured
- [x] Graceful shutdown implemented
- [x] Memory monitoring enabled
- [x] PM2 configuration created
- [x] Azure startup script created
- [ ] Azure health probe configured
- [ ] Application Insights configured
- [ ] Uptime monitoring setup
- [ ] Error alerting configured

## Best Practices

1. **Never let uncaught errors crash the app** - Always use try/catch
2. **Monitor memory usage** - Restart before OOM
3. **Use health checks** - Let Azure/K8s know app status
4. **Log everything** - Errors, warnings, important events
5. **Graceful degradation** - App should work even if some features fail
6. **Test failure scenarios** - Simulate crashes, DB failures, etc.

## Testing Reliability

```bash
# Test graceful shutdown
kill -SIGTERM <pid>

# Test memory limits
node --max-old-space-size=100 server.js

# Test error handling
curl -X POST /api/test-error

# Check health
curl https://api.doclittle.site/health?detailed=true
```

## Emergency Procedures

### If API Crashes:
1. Azure will auto-restart (within 30s)
2. Check logs: `az webapp log tail --name doclittle`
3. Review error logs in database
4. Check health endpoint
5. Scale up if needed: `az webapp scale --name doclittle --instance-count 2`

### If Database Issues:
1. App continues with degraded functionality
2. Check database file permissions
3. Review database logs
4. Restart app to reinitialize connections

## Conclusion

The API is now protected with multiple layers of reliability:
- ✅ Error handling prevents crashes
- ✅ Auto-restart on failure
- ✅ Health monitoring
- ✅ Memory leak prevention
- ✅ Graceful shutdown
- ✅ Database resilience
- ✅ Overload protection

**The foundation is solid and designed to run continuously.**


