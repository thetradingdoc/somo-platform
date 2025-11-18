/**
 * Enhanced Request Logging Middleware
 * Logs all API requests to database for usage tracking and debugging
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../database');

/**
 * Enhanced request logger that writes to database
 */
function usageLogger(req, res, next) {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  // Attach request ID to request for error tracking
  req.requestId = requestId;
  
  // Get customer info from request (if available)
  // This will be populated by API key authentication middleware later
  const customerId = req.customer_id || null;
  const apiKeyId = req.api_key_id || null;
  
  // Calculate request size
  const requestSize = req.headers['content-length'] 
    ? parseInt(req.headers['content-length']) 
    : (req.body ? JSON.stringify(req.body).length : 0);
  
  // Get IP address
  const ipAddress = req.ip || 
    req.headers['x-forwarded-for']?.split(',')[0] || 
    req.connection.remoteAddress;
  
  // Get user agent
  const userAgent = req.headers['user-agent'] || null;
  
  // Log response when finished
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const responseSize = res.get('content-length') 
      ? parseInt(res.get('content-length')) 
      : 0;
    
    // Log to database (async, don't block response)
    setImmediate(() => {
      try {
        db.logAPIUsage({
          id: requestId,
          customer_id: customerId,
          api_key_id: apiKeyId,
          endpoint: req.path,
          method: req.method,
          status_code: res.statusCode,
          response_time_ms: responseTime,
          request_size_bytes: requestSize,
          response_size_bytes: responseSize,
          ip_address: ipAddress,
          user_agent: userAgent,
          request_id: requestId
        });
      } catch (error) {
        // Don't fail request if logging fails
        console.error('⚠️  Failed to log API usage:', error.message);
      }
    });
  });
  
  // Also log to console (existing behavior)
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - IP: ${ipAddress} - Request ID: ${requestId}`);
  
  next();
}

/**
 * Log voice call
 */
function logVoiceCall(callData) {
  try {
    db.logVoiceCall({
      id: uuidv4(),
      customer_id: callData.customer_id || null,
      call_id: callData.call_id,
      call_duration_seconds: callData.duration_seconds || null,
      function_calls_count: callData.function_calls_count || 0,
      status: callData.status || 'completed'
    });
  } catch (error) {
    console.error('⚠️  Failed to log voice call:', error.message);
  }
}

/**
 * Log function call
 */
function logFunctionCall(functionData) {
  try {
    db.logFunctionCall({
      id: uuidv4(),
      customer_id: functionData.customer_id || null,
      call_id: functionData.call_id || null,
      function_name: functionData.function_name,
      parameters: functionData.parameters || null,
      response_time_ms: functionData.response_time_ms || null,
      success: functionData.success !== false,
      error_message: functionData.error_message || null
    });
  } catch (error) {
    console.error('⚠️  Failed to log function call:', error.message);
  }
}

/**
 * Log error
 */
function logError(errorData) {
  try {
    db.logError({
      id: uuidv4(),
      customer_id: errorData.customer_id || null,
      error_type: errorData.error_type || 'Error',
      error_message: errorData.error_message || 'Unknown error',
      stack_trace: errorData.stack_trace || null,
      request_id: errorData.request_id || null,
      endpoint: errorData.endpoint || null,
      context: errorData.context || null,
      severity: errorData.severity || 'medium'
    });
  } catch (error) {
    console.error('⚠️  Failed to log error:', error.message);
  }
}

module.exports = {
  usageLogger,
  logVoiceCall,
  logFunctionCall,
  logError
};

