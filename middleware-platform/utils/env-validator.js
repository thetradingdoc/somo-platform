/**
 * Environment Variable Validator
 * Validates that all required environment variables are set
 * SECURITY: Fails fast in production if critical secrets are missing
 */

// Detect Azure App Service environment
const isAzure = process.env.WEBSITE_SITE_NAME || process.env.AZURE_WEBSITE_INSTANCE_ID || process.env.WEBSITE_INSTANCE_ID;
const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod' || isAzure;

/**
 * Required environment variables by category
 */
const REQUIRED_VARS = {
  // Critical security secrets (required in production)
  critical: [
    'ADMIN_PORTAL_SECRET',
    'API_KEY_ENCRYPTION_KEY',
    'RETELL_WEBHOOK_SECRET'
  ],
  
  // Payment processing (required if payment features are used)
  payment: [
    'STRIPE_SECRET_KEY',
    'STRIPE_PUBLISHABLE_KEY',
    'STRIPE_WEBHOOK_SECRET'
  ],
  
  // Core services (required for basic functionality)
  core: [
    // Voice / agent
    'RETELL_API_KEY',
    'RETELL_AGENT_ID',
    // HTTP / URL configuration
    'BASE_URL',
    'API_BASE_URL'
  ],
  
  // Optional but recommended
  optional: [
    'POSTGRES_URL', // If using Postgres
    'TWILIO_ACCOUNT_SID', // If using SMS
    'TWILIO_AUTH_TOKEN', // If using SMS
    'TWILIO_PHONE_NUMBER', // If using SMS
    'STEDI_API_KEY', // If using insurance features
    'CIRCLE_API_KEY', // If using Circle payments
    'CIRCLE_ENTITY_SECRET', // If using Circle payments
    'GOOGLE_CLIENT_ID', // If using Google Calendar
    'GOOGLE_CLIENT_SECRET', // If using Google Calendar
    'GROQ_API_KEY', // If using medical coding
    'AZURE_COMMUNICATION_CONNECTION_STRING', // If using Azure email
    'SMTP_HOST', // If using SMTP email
  ]
};

/**
 * Validate environment variables
 * @param {Object} options - Validation options
 * @param {boolean} options.strict - If true, fail on missing critical vars even in dev
 * @param {boolean} options.checkPayment - If true, validate payment vars
 * @returns {Object} Validation result
 */
function validateEnvVars(options = {}) {
  const { strict = false, checkPayment = false } = options;
  const errors = [];
  const warnings = [];
  const missing = {
    critical: [],
    payment: [],
    core: []
  };

  // Check critical secrets
  for (const varName of REQUIRED_VARS.critical) {
    if (!process.env[varName]) {
      missing.critical.push(varName);
      if (isProduction || strict) {
        errors.push(`CRITICAL: ${varName} is required but not set`);
      } else {
        warnings.push(`WARNING: ${varName} is not set (required in production)`);
      }
    }
  }

  // Check payment vars if requested
  if (checkPayment) {
    for (const varName of REQUIRED_VARS.payment) {
      if (!process.env[varName]) {
        missing.payment.push(varName);
        if (isProduction || strict) {
          errors.push(`CRITICAL: ${varName} is required for payment features but not set`);
        } else {
          warnings.push(`WARNING: ${varName} is not set (required for payment features)`);
        }
      }
    }
  }

  // Check core vars
  for (const varName of REQUIRED_VARS.core) {
    if (!process.env[varName]) {
      missing.core.push(varName);
      errors.push(`CRITICAL: ${varName} is required but not set`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missing,
    isProduction
  };
}

/**
 * Validate and exit if critical vars are missing in production
 */
function validateAndExitIfInvalid() {
  // In production (or Azure), also validate payment vars so misconfigured Stripe
  // is surfaced clearly at startup via warnings/errors.
  const result = validateEnvVars({ strict: isProduction, checkPayment: true });
  
  if (result.warnings.length > 0) {
    console.warn('\n⚠️  ENVIRONMENT VARIABLE WARNINGS:');
    result.warnings.forEach(w => console.warn(`  ${w}`));
  }
  
  if (result.errors.length > 0) {
    console.error('\n❌ ENVIRONMENT VARIABLE ERRORS:');
    result.errors.forEach(e => console.error(`  ${e}`));
    
    // In production, only exit if critical security vars are missing
    // Core vars (RETELL_API_KEY, RETELL_AGENT_ID) are required for voice features
    // But we should allow the server to start even if some are missing (with warnings)
    const criticalErrors = result.errors.filter(e => 
      e.includes('ADMIN_PORTAL_SECRET') || 
      e.includes('API_KEY_ENCRYPTION_KEY') ||
      e.includes('RETELL_WEBHOOK_SECRET')
    );
    
    const coreErrors = result.errors.filter(e => 
      e.includes('RETELL_API_KEY') || 
      e.includes('RETELL_AGENT_ID')
    );
    
    // Only exit if critical security vars are missing in production
    // BUT: Allow Azure App Service to start even if some vars are missing (they may be set via App Settings)
    // Azure sets NODE_ENV=production, but env vars might not be loaded yet
    const isAzure = process.env.WEBSITE_SITE_NAME || process.env.AZURE_WEBSITE_INSTANCE_ID;
    
    if (isProduction && criticalErrors.length > 0 && !isAzure) {
      console.error('\n❌ Server cannot start with missing critical security variables in production.');
      console.error('   Please set all required variables and restart the server.\n');
      process.exit(1);
    }
    
    // In Azure, log warnings but don't exit (env vars might be set via App Settings)
    if (isProduction && criticalErrors.length > 0 && isAzure) {
      console.warn('\n⚠️  Critical security variables missing - checking Azure App Settings...');
      console.warn('   If these are set in Azure Portal, the server will continue.');
      console.warn('   Missing:', criticalErrors.map(e => e.split(':')[1]?.trim()).join(', '));
    }
    
    // For core vars, log warning but allow server to start (voice features will be disabled)
    if (coreErrors.length > 0) {
      console.warn('\n⚠️  Core service variables missing - some features will be disabled:');
      coreErrors.forEach(e => console.warn(`  ${e}`));
      console.warn('   Server will start but voice agent features may not work.\n');
    }
  }
  
  if (result.valid || (result.errors.length > 0 && !isProduction)) {
    console.log('✅ Environment variables validated (with warnings)');
  }
  
  return result;
}

/**
 * Get list of all required environment variables (for documentation)
 */
function getRequiredVars() {
  return {
    critical: REQUIRED_VARS.critical,
    payment: REQUIRED_VARS.payment,
    core: REQUIRED_VARS.core,
    optional: REQUIRED_VARS.optional,
    all: [
      ...REQUIRED_VARS.critical,
      ...REQUIRED_VARS.payment,
      ...REQUIRED_VARS.core,
      ...REQUIRED_VARS.optional
    ]
  };
}

module.exports = {
  validateEnvVars,
  validateAndExitIfInvalid,
  getRequiredVars,
  REQUIRED_VARS,
  isProduction
};

