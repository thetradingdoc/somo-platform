/**
 * SIGNUP ROUTES
 * Handles customer signup, email verification, and terms acceptance
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('../database');
const EmailService = require('../services/email-service');
const ProviderService = require('../services/provider-service');
const RetellService = require('../services/retell-service');
const TwilioPhoneService = require('../services/twilio-phone-service');
const { v4: uuidv4 } = require('uuid');
const { authLimiter: rateLimiter, lenientAuthLimiter } = require('../middleware/rate-limiter');
const { generateSimplePassword } = require('../utils/password-generator');
const { requireCustomerAuth } = require('../middleware/customer-auth');
const {
  ensureClaimSessionTables,
  claimLandingSessionToCustomer,
  listCustomerProducts
} = require('../services/landing-session-claim-service');

// Load bcryptjs for password hashing
let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch (e) {
  console.error('❌ bcryptjs not installed - password hashing will fail');
  bcrypt = null;
}

// Initialize Stripe with proper configuration
const stripeConfig = require('../utils/stripe-config');
let stripe = null;
try {
  stripe = stripeConfig.initializeStripe();
} catch (error) {
  console.error('⚠️  Stripe initialization failed:', error.message);
  // Continue without Stripe - payment features will be disabled
}

const router = express.Router();

/** Canonical provider portal home after SaaS signup (see server.js SAAS_PROVIDER_PORTAL_HOME). */
const SAAS_PORTAL_HOME = '/business/today.html';

/**
 * Get cookie options for customer session
 * Sets domain for cross-subdomain access in production
 */
function getSessionCookieOptions(req, maxAge = 30 * 24 * 60 * 60 * 1000) {
  const isSecure = process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
  const options = {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: maxAge
  };
  
  // Set domain for cross-subdomain cookie sharing in production
  const cookieHost = (req.headers.host || '').toLowerCase();
  if (process.env.NODE_ENV === 'production') {
    if (cookieHost.includes('myskinandcare.com')) options.domain = '.myskinandcare.com';
    else if (cookieHost.includes('skinandcare.com')) options.domain = '.skinandcare.com';
    else if (cookieHost.includes('doclittle.site')) options.domain = '.doclittle.site';
  }
  
  return options;
}

// Note: Root GET / is handled in server.js with domain-based routing
// This router only handles API endpoints (POST /api/signup, etc.)

/**
 * POST /api/signup
 * Create new customer account and send verification code
 */
router.post('/signup', rateLimiter, async (req, res) => {
  try {
    const {
      name,
      email,
      phone_number,
      company_name,
      business_size,
      use_case,
      api_features,
      customer_type,
      first_name,
      last_name,
      city,
      postal_code,
      country,
      country_code,
      medical_specialty,
      license_number,
      license_state,
      license_region,
      languages,
      attribution,
      require_provider_profile
    } = req.body;

    // Build name from first_name + last_name if provided (specialist portal)
    const fullName = (first_name || last_name)
      ? [first_name, last_name].filter(Boolean).join(' ').trim()
      : name;

    console.log(`📝 Signup request - customer_type: ${customer_type || 'undefined'}, specialist: ${!!(first_name || last_name)}`);

    // Validation
    if (!fullName || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and email are required'
      });
    }

    // Full provider profile only when explicitly requested or specialty supplied (license optional for light SaaS)
    const needsFullProviderProfile =
      require_provider_profile === true || !!medical_specialty;
    if (needsFullProviderProfile) {
      const licenseRegionVal = license_state || license_region;
      if (!license_number || !licenseRegionVal) {
        return res.status(400).json({
          success: false,
          error: 'License number and state/region are required when medical specialty is provided'
        });
      }
      if (!city || !postal_code || !country) {
        return res.status(400).json({
          success: false,
          error: 'City, postal code, and country are required for provider profile'
        });
      }
      if (!medical_specialty) {
        return res.status(400).json({
          success: false,
          error: 'Medical specialty is required for provider profile'
        });
      }
    }

    // Validate customer_type
    const validCustomerTypes = ['api', 'saas'];
    const customerType = customer_type || 'saas'; // Default to 'saas' (most common use case)
    if (!validCustomerTypes.includes(customerType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid customer type',
        message: 'Customer type must be "api" or "saas"'
      });
    }

    // SaaS customers require phone number
    if (customerType === 'saas' && !phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Phone number required',
        message: 'SaaS customers must provide a phone number'
      });
    }

    // Validate API features if provided (should be array)
    if (api_features && !Array.isArray(api_features)) {
      return res.status(400).json({
        success: false,
        error: 'API features must be an array'
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Check if email already exists
    const existingCustomer = db.getCustomerByEmail(email);
    if (existingCustomer) {
      // Allow bypass for test emails when ALLOW_TEST_EMAIL_BYPASS is enabled
      const isTestEmail = email.includes('+test@') || email.includes('+6@gmail.com');
      if (isTestEmail && process.env.ALLOW_TEST_EMAIL_BYPASS === 'true') {
        console.log(`⚠️  Test email bypass enabled for: ${email} - using existing customer`);
        // Use existing customer ID instead of creating new one
        const customerId = existingCustomer.id;

        // Generate verification code for existing customer
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        db.createEmailVerificationCode(email, verificationCode, customerId);

        // Send verification email
        try {
          await EmailService.sendVerificationCode(email, verificationCode, existingCustomer.name);
        } catch (emailError) {
          console.error('❌ Failed to send verification email:', emailError);
        }

        return res.json({
          success: true,
          message: 'Verification code sent to your email (test bypass)',
          customer_id: customerId,
          email: email
        });
      } else {
        return res.status(409).json({
          success: false,
          error: 'Email already registered',
          message: 'This email is already associated with an account'
        });
      }
    }

    // Check for active verification code (rate limiting)
    const activeCode = db.getActiveEmailVerificationCode(email);
    if (activeCode) {
      const timeSinceLastCode = Date.now() - new Date(activeCode.created_at).getTime();
      if (timeSinceLastCode < 60 * 1000) { // 1 minute cooldown
        return res.status(429).json({
          success: false,
          error: 'Please wait before requesting another code',
          retry_after: Math.ceil((60 * 1000 - timeSinceLastCode) / 1000)
        });
      }
    }

    // Build provider_profile for specialist signups
    // Languages: array of ISO 639-1 codes for patient matching (preferred_language)
    // Location: country_code (ISO 3166), country (name), city, postal_code
    // License: license_region = state code (US) or region text (e.g. England, Ontario)
    const licenseRegion = license_state || license_region;
    const languagesArray = Array.isArray(languages)
      ? languages.filter(Boolean)
      : (typeof languages === 'string' ? languages.split(',').map(s => s.trim()).filter(Boolean) : []);

    const providerProfile = (first_name || last_name || medical_specialty || city || country)
      ? {
          first_name: first_name || null,
          last_name: last_name || null,
          city: city || null,
          postal_code: postal_code || null,
          country: country || null,
          country_code: country_code || null,
          medical_specialty: medical_specialty || null,
          license_number: license_number || null,
          license_region: licenseRegion || null,
          languages: languagesArray
        }
      : null;

    // Create customer account (pending email verification)
    const customerId = `cust_${uuidv4()}`;
    const customerRecord = {
      id: customerId,
      name: fullName,
      email,
      phone_number: phone_number || null,
      company_name: company_name || null,
      business_size: business_size || null,
      use_case: use_case || null,
      api_features: api_features || [],
      customer_type: customerType,
      pricing_tier: 'starter',
      status: 'pending',
      email_verified: false,
      provider_profile: providerProfile
    };
    if (attribution && typeof attribution === 'object') {
      customerRecord.signup_attribution_json = JSON.stringify(attribution);
    } else if (req.query.utm_source || req.query.utm_campaign) {
      customerRecord.signup_attribution_json = JSON.stringify({
        utm_source: req.query.utm_source || null,
        utm_campaign: req.query.utm_campaign || null,
        utm_medium: req.query.utm_medium || null
      });
    }

    db.createCustomer(customerRecord);
    const postCreatePatch = { customer_type: customerType };
    if (customerRecord.signup_attribution_json) {
      postCreatePatch.signup_attribution_json = customerRecord.signup_attribution_json;
    }
    db.updateCustomer(customerId, postCreatePatch);

    // Track incomplete signup (Step 1: Started)
    try {
      const env = process.env.NODE_ENV || 'development';
      db.createIncompleteSignup({
        name: fullName,
        email,
        phone_number: phone_number || null,
        company_name: company_name || null,
        business_size: business_size || null,
        use_case: use_case || null,
        api_features: api_features || [],
        customer_type: customerType,
        signup_step: 'started',
        source: 'signup_page',
        metadata: JSON.stringify({
          customer_id: customerId,
          environment: env,
          signup_started_at: new Date().toISOString()
        })
      });
      console.log(`📝 Created incomplete signup record for ${email} (step: started, env: ${env})`);
    } catch (incompleteError) {
      console.warn('⚠️  Failed to create incomplete signup record:', incompleteError.message);
      // Continue - this is tracking only, don't block signup
    }

    // Create/Update lead in pipeline
    try {
      db.upsertLeadFromCustomer({
        id: customerId,
        name: fullName,
        email,
        phone_number: phone_number || null,
        company_name: company_name || null,
        business_size: business_size || null,
        use_case: use_case || null
      }, {
        source: 'self_signup',
        pipeline_stage: 'new',
        status: 'new',
        activity_subject: 'Signup form submitted',
        activity_description: `${fullName} (${email}) submitted the signup form.`
      });
    } catch (leadError) {
      console.warn('⚠️  Failed to create signup lead:', leadError.message);
    }

    // Generate verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code

    // Create verification code record
    db.createEmailVerificationCode(email, verificationCode, customerId);

    // Send verification email
    try {
      await EmailService.sendVerificationCode(email, verificationCode, fullName);
    } catch (emailError) {
      console.error('❌ Failed to send verification email:', emailError);
      // Continue - customer can request another code
    }

    res.json({
      success: true,
      message: 'Verification code sent to your email',
      customer_id: customerId,
      email: email // Don't send full email for security, but useful for client
    });
  } catch (error) {
    console.error('❌ Signup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create account',
      message: error.message
    });
  }
});

/**
 * POST /api/signup/update-email
 * Update email address before verification
 */
router.post('/signup/update-email', rateLimiter, async (req, res) => {
  try {
    const { customer_id, old_email, new_email } = req.body;

    if (!customer_id || !old_email || !new_email) {
      return res.status(400).json({
        success: false,
        error: 'customer_id, old_email, and new_email are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(new_email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Get customer
    const customer = db.getCustomer(customer_id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Verify old email matches
    if (customer.email.toLowerCase() !== old_email.toLowerCase()) {
      return res.status(400).json({
        success: false,
        error: 'Old email does not match customer record'
      });
    }

    // Check if new email is already taken
    const existingCustomer = db.getCustomerByEmail(new_email);
    if (existingCustomer && existingCustomer.id !== customer_id) {
      return res.status(400).json({
        success: false,
        error: 'This email is already registered'
      });
    }

    // Check if customer is already verified (prevent changing verified email)
    if (customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Cannot change email after verification. Please contact support.'
      });
    }

    // Update email
    db.updateCustomer(customer_id, { email: new_email });

    // Delete old verification codes
    db.prepare('DELETE FROM email_verification_codes WHERE email = ?').run(old_email);

    // Generate and send new verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Create verification code (same format as signup)
    db.createEmailVerificationCode(new_email, code, customer_id);

    // Send email
    try {
      await EmailService.sendVerificationCode(new_email, code);
      console.log(`✅ Verification code sent to ${new_email} for customer ${customer_id}`);
    } catch (emailError) {
      console.error('⚠️  Failed to send verification email:', emailError);
      // Continue - code is still saved in DB
    }

    res.json({
      success: true,
      message: 'Email updated successfully. New verification code sent.',
      email: new_email
    });
  } catch (error) {
    console.error('❌ Update email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update email',
      message: error.message
    });
  }
});

/**
 * POST /api/signup/verify-email
 * Verify email code and activate account
 */
router.post('/signup/verify-email', rateLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: 'Email and verification code are required'
      });
    }

    // Verify code
    const verification = db.verifyEmailCode(email, code);
    if (!verification) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification code',
        message: 'The verification code is incorrect or has expired. Please request a new code.'
      });
    }

    // Get customer
    const customer = db.getCustomer(verification.customer_id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Mark lead as qualified
    try {
      db.qualifyLeadByEmail(customer.email, {
        activity_description: 'Email verified via signup flow.',
        notes: `Signup verified on ${new Date().toISOString()}`
      });
    } catch (leadError) {
      console.warn('⚠️  Failed to qualify lead after verification:', leadError.message);
    }

    // Update incomplete signup progress (Step 2: Email Verified)
    try {
      const incompleteSignup = db.getIncompleteSignupByEmail(email);
      if (incompleteSignup) {
        db.updateIncompleteSignup(incompleteSignup.id, {
          signup_step: 'email_verified',
          last_step_completed_at: new Date().toISOString()
        });
        console.log(`📝 Updated incomplete signup for ${email} (step: email_verified)`);
      }
    } catch (incompleteError) {
      console.warn('⚠️  Failed to update incomplete signup:', incompleteError.message);
    }

    // Create session
    const sessionId = db.createCustomerSession(
      customer.id,
      req.ip,
      req.get('user-agent')
    );

    // Set session cookie
    res.cookie('customer_session', sessionId, getSessionCookieOptions(req));

    // Check if customer_type is already set AND is valid
    // Always show integration selection if customer_type is not explicitly set or is invalid
    const hasCustomerType = customer.customer_type && (customer.customer_type === 'api' || customer.customer_type === 'saas');

    // Log for debugging
    console.log(`✅ Email verified for customer ${customer.id}, customer_type: ${customer.customer_type || 'null'}, hasCustomerType: ${hasCustomerType}`);

    // Log customer_type for debugging
    console.log(`✅ Email verified for customer ${customer.id}, customer_type in DB: ${customer.customer_type || 'null'}`);

    const { isTrialSimEnabledForCustomer } = require('../services/trial-lifecycle');
    const trialSimFlow =
      (customer.customer_type || 'saas') === 'saas' && isTrialSimEnabledForCustomer(customer);

    res.json({
      success: true,
      message: 'Email verified successfully',
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        email_verified: true,
        customer_type: customer.customer_type || null,
        merchant_id: customer.merchant_id || null,
        phone_number: customer.phone_number || null,
        twilio_phone_number: customer.twilio_phone_number || null,
        trial_status: customer.trial_status || null
      },
      trial_sim_flow: trialSimFlow,
      next_step: trialSimFlow ? 'verify_phone' : 'accept_terms'
    });
  } catch (error) {
    console.error('❌ Email verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify email',
      message: error.message
    });
  }
});

/**
 * POST /api/signup/verify-phone/send
 * Send SMS OTP via Twilio Verify (requires session + verified email).
 */
router.post('/signup/verify-phone/send', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Session required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer?.email_verified) {
      return res.status(400).json({ success: false, error: 'Email not verified' });
    }

    const { phone_number } = req.body;
    const phone = phone_number || customer.phone_number;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number required' });
    }

    const { normalizePhone, sendPhoneVerification } = require('../services/twilio-verify-service');
    const { canStartTrial } = require('../services/trial-lifecycle');
    const e164 = normalizePhone(phone);
    const gate = canStartTrial(db, customer.id, e164);
    if (!gate.allowed && gate.reason === 'phone_trial_in_use') {
      return res.status(409).json({
        success: false,
        error: 'This phone number already has an active trial'
      });
    }

    db.updateCustomer(customer.id, { phone_number: e164 });
    const result = await sendPhoneVerification(e164);
    res.json({ success: true, message: 'Verification code sent', to: result.to, mock: result.mock || false });
  } catch (error) {
    console.error('❌ verify-phone/send:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/signup/verify-phone/check
 * Confirm OTP; start SIM trial when enabled.
 */
router.post('/signup/verify-phone/check', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Session required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer?.email_verified) {
      return res.status(400).json({ success: false, error: 'Email not verified' });
    }

    const { phone_number, code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Verification code required' });
    }

    const { normalizePhone, checkPhoneVerification } = require('../services/twilio-verify-service');
    const {
      TrialProvisionError,
      isTrialSimEnabledForCustomer,
      startTrialTenant
    } = require('../services/trial-lifecycle');

    const e164 = normalizePhone(phone_number || customer.phone_number);
    const check = await checkPhoneVerification(e164, code);
    if (!check.approved) {
      return res.status(400).json({ success: false, error: 'Invalid or expired code' });
    }

    const now = new Date().toISOString();
    db.updateCustomer(customer.id, {
      phone_number: e164,
      phone_verified: 1,
      phone_verified_at: now
    });

    let trial = null;
    const refreshed = db.getCustomer(customer.id);
    if (isTrialSimEnabledForCustomer(refreshed)) {
      try {
        trial = await startTrialTenant(db, customer.id, {
          phoneE164: e164,
          phoneVerifiedAt: now
        });
      } catch (err) {
        if (err instanceof TrialProvisionError) {
          return res.status(502).json({
            success: false,
            error: err.message,
            code: err.code,
            phone_verified: true
          });
        }
        throw err;
      }
      if (!trial?.twilio_phone_number) {
        return res.status(502).json({
          success: false,
          error: 'Dedicated clinic line could not be assigned. Please try again.',
          code: 'twilio_provision_failed',
          phone_verified: true
        });
      }
    }

    try {
      const incompleteSignup = db.getIncompleteSignupByEmail(refreshed.email);
      if (incompleteSignup) {
        db.updateIncompleteSignup(incompleteSignup.id, {
          signup_step: 'phone_verified',
          last_step_completed_at: now
        });
      }
    } catch (_) {}

    const afterTrial = db.getCustomer(customer.id);
    const simTrialOn =
      (afterTrial.customer_type || 'saas') === 'saas' && isTrialSimEnabledForCustomer(afterTrial);
    res.json({
      success: true,
      message: trial?.twilio_phone_number
        ? 'Phone verified. Your dedicated line is ready.'
        : 'Phone verified',
      phone_verified: true,
      trial_sim_flow: simTrialOn,
      trial,
      customer: serializeSignupSessionCustomer(afterTrial),
      next_step: 'accept_terms',
      redirect: '/terms?customer_type=saas'
    });
  } catch (error) {
    console.error('❌ verify-phone/check:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

function serializeSignupSessionCustomer(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone_number: customer.phone_number || null,
    twilio_phone_number: customer.twilio_phone_number || null,
    company_name: customer.company_name || null,
    merchant_id: customer.merchant_id || null,
    customer_type: customer.customer_type || 'saas',
    trial_status: customer.trial_status || null,
    phone_verified: customer.phone_verified === 1,
    email_verified: customer.email_verified === 1
  };
}

/**
 * GET /api/signup/session
 * Lightweight session snapshot for signup/portal UI (no terms gate).
 */
router.get('/signup/session', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Session required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    if (!customer.email_verified) {
      return res.status(400).json({ success: false, error: 'Email not verified' });
    }
    const { isTrialSimEnabledForCustomer } = require('../services/trial-lifecycle');
    res.json({
      success: true,
      customer: serializeSignupSessionCustomer(customer),
      trial_sim_flow:
        (customer.customer_type || 'saas') === 'saas' && isTrialSimEnabledForCustomer(customer)
    });
  } catch (error) {
    console.error('❌ signup/session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/signin
 * Request sign-in code for existing customer
 */
router.post('/signin', rateLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Check if customer exists
    const customer = db.getCustomerByEmail(email);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        message: 'No account found with this email. Please sign up first.'
      });
    }

    // Check for active verification code (rate limiting)
    const activeCode = db.getActiveEmailVerificationCode(email);
    if (activeCode) {
      const timeSinceLastCode = Date.now() - new Date(activeCode.created_at).getTime();
      if (timeSinceLastCode < 60 * 1000) { // 1 minute cooldown
        return res.status(429).json({
          success: false,
          error: 'Please wait before requesting another code',
          retry_after: Math.ceil((60 * 1000 - timeSinceLastCode) / 1000)
        });
      }
    }

    // Generate verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code

    // Create verification code record
    db.createEmailVerificationCode(email, verificationCode, customer.id);

    // Send verification email
    try {
      await EmailService.sendVerificationCode(email, verificationCode, customer.name);
    } catch (emailError) {
      console.error('❌ Failed to send verification email:', emailError);
      return res.status(500).json({
        success: false,
        error: 'Failed to send verification email',
        message: 'Please try again later'
      });
    }

    res.json({
      success: true,
      message: 'Sign-in code sent to your email',
      email: email
    });
  } catch (error) {
    console.error('❌ Sign-in error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send sign-in code',
      message: error.message
    });
  }
});

/**
 * POST /api/customers/forgot-password
 * Request password reset
 */
router.post('/customers/forgot-password', rateLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Get customer by email
    const customer = db.getCustomerByEmail(email);
    if (!customer) {
      // Don't reveal if email exists (security best practice)
      return res.json({
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store reset token using email verification codes table (reusing existing infrastructure)
    // The code field will store the reset token
    db.createEmailVerificationCode(email, resetToken, customer.id);

    // Get merchant for subdomain
    let subdomain = null;
    if (customer.merchant_id) {
      const merchant = db.getMerchant(customer.merchant_id);
      if (merchant && merchant.subdomain) {
        subdomain = merchant.subdomain;
      }
    }

    const baseDomain = process.env.BASE_DOMAIN || 'myskinandcare.com';
    const resetUrl = subdomain
      ? `https://${subdomain}.${baseDomain}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`
      : `${process.env.BASE_URL || 'http://localhost:4000'}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    // Send password reset email
    try {
      await EmailService.sendPasswordResetEmail(email, customer.name || customer.company_name, resetUrl);
    } catch (emailError) {
      console.error('❌ Failed to send password reset email:', emailError);
      return res.status(500).json({
        success: false,
        error: 'Failed to send reset email',
        message: 'Please try again later'
      });
    }

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.'
    });
  } catch (error) {
    console.error('❌ Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process request',
      message: error.message
    });
  }
});

/**
 * POST /api/customers/change-password
 * Change password (requires current password)
 */
router.post('/customers/change-password', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const customer = req.customer;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 8 characters'
      });
    }

    // Verify current password
    if (!bcrypt) {
      return res.status(500).json({
        success: false,
        error: 'Password verification unavailable'
      });
    }

    if (!customer.password_hash) {
      return res.status(400).json({
        success: false,
        error: 'No password set. Please use password reset instead.'
      });
    }

    const passwordMatch = await bcrypt.compare(currentPassword, customer.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    db.updateCustomer(customer.id, { password_hash: passwordHash, password_updated_at: new Date().toISOString() });

    console.log(`✅ Password changed for customer ${customer.id}`);

    // TODO: Send confirmation email
    // TODO: Optionally invalidate other sessions

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('❌ Change password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password',
      message: error.message
    });
  }
});

/**
 * POST /api/customers/reset-password
 * Reset password using token from email
 */
router.post('/customers/reset-password', rateLimiter, async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Email, token, and new password are required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }

    // Verify reset token (stored in email_verification_codes table)
    const verification = db.verifyEmailCode(email, token);
    if (!verification) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired reset token',
        message: 'The reset link is invalid or has expired. Please request a new password reset.'
      });
    }

    // Get customer
    const customer = db.getCustomerByEmail(email);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Hash new password
    if (!bcrypt) {
      return res.status(500).json({
        success: false,
        error: 'Password hashing unavailable',
        message: 'Password hashing is not configured. Please contact support.'
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    db.updateCustomer(customer.id, { password_hash: passwordHash, password_updated_at: new Date().toISOString() });

    // Mark verification code as used (invalidate reset token)
    db.prepare(`
      UPDATE email_verification_codes 
      SET verified = 1, verified_at = CURRENT_TIMESTAMP
      WHERE email = ? AND code = ?
    `).run(email, token);

    console.log(`✅ Password reset successful for customer ${customer.id}`);

    res.json({
      success: true,
      message: 'Password reset successfully. You can now log in with your new password.'
    });
  } catch (error) {
    console.error('❌ Reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password',
      message: error.message
    });
  }
});

/**
 * POST /api/customers/login
 * Password-based login for customers
 */
// Use a more lenient limiter here to avoid 429s during normal tenant logins
router.post('/customers/login', lenientAuthLimiter || rateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      console.log('[CUSTOMERS LOGIN] ❌ Missing email or password');
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    console.log('[CUSTOMERS LOGIN] 🔍 Login attempt', {
      email,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    // Get customer by email
    const customer = db.getCustomerByEmail(email);
    if (!customer) {
      console.log('[CUSTOMERS LOGIN] ❌ Customer not found for email', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Check if customer has a password_hash
    if (!customer.password_hash) {
      return res.status(403).json({
        success: false,
        error: 'Password not set',
        message: 'Your account does not have a password set. Please use the password from your welcome email or contact support.'
      });
    }

    // Verify password
    if (!bcrypt) {
      console.error('[CUSTOMERS LOGIN] ❌ Bcrypt not available on server');
      return res.status(500).json({
        success: false,
        error: 'Password verification unavailable',
        message: 'Password hashing is not configured. Please contact support.'
      });
    }

    const passwordMatch = await bcrypt.compare(password, customer.password_hash);
    if (!passwordMatch) {
      console.log('[CUSTOMERS LOGIN] ❌ Password mismatch for customer', customer.id);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Check if email is verified
    if (!customer.email_verified) {
      console.log('[CUSTOMERS LOGIN] ❌ Email not verified for customer', customer.id);
      return res.status(403).json({
        success: false,
        error: 'Email not verified',
        message: 'Please verify your email address before logging in.'
      });
    }

    // Platform admin may suspend a tenant (customer.status !== 'active')
    const st = (customer.status || 'active').toLowerCase();
    if (st !== 'active') {
      console.log('[CUSTOMERS LOGIN] ❌ Customer not active:', customer.id, st);
      return res.status(403).json({
        success: false,
        error: 'Account suspended',
        message: 'This account is not active. Contact support if you believe this is an error.'
      });
    }

    // NOTE: Terms acceptance check removed - customers can login without accepting terms
    // Auto-accept terms for tenant customers (they're already using the platform)
    let termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    
    if (!termsAccepted && customer.merchant_id) {
      // Auto-accept terms for tenant customers
      try {
        db.acceptTerms(
          customer.id,
          '1.0',
          req.ip,
          req.get('user-agent')
        );
        termsAccepted = true;
        console.log('[CUSTOMERS LOGIN] ✅ Auto-accepted terms for tenant customer', customer.id);
      } catch (termsError) {
        console.warn('[CUSTOMERS LOGIN] ⚠️  Could not auto-accept terms:', termsError.message);
      }
    } else if (!termsAccepted) {
      console.log('[CUSTOMERS LOGIN] ⚠️  Terms not accepted for customer', customer.id, '- allowing login anyway');
    }

    // Check for "Remember me" option
    const rememberMe = req.body.remember_me === true || req.body.remember_me === 'true';
    const sessionDuration = rememberMe
      ? 90 * 24 * 60 * 60 * 1000  // 90 days if "Remember me" is checked
      : 30 * 24 * 60 * 60 * 1000; // 30 days default

    // Create session
    const sessionId = `sess_${crypto.randomBytes(32).toString('hex')}`;
    const expiresAt = new Date(Date.now() + sessionDuration);

    db.createCustomerSession({
      id: sessionId,
      customer_id: customer.id,
      expires_at: expiresAt.toISOString(),
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    });

    console.log('[CUSTOMERS LOGIN] ✅ Login successful', {
      customerId: customer.id,
      email: customer.email,
      merchantId: customer.merchant_id
    });

    // Set session cookie
    res.cookie('customer_session', sessionId, getSessionCookieOptions(req, sessionDuration));

    // Get merchant for subdomain
    let merchant = null;
    if (customer.merchant_id) {
      merchant = db.getMerchant(customer.merchant_id);
    }

    res.json({
      success: true,
      message: 'Login successful',
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        company_name: customer.company_name,
        customer_type: customer.customer_type,
        merchant_id: customer.merchant_id,
        subdomain: merchant?.subdomain || null,
        terms_accepted: termsAccepted || (customer.merchant_id ? true : false) // Auto-accepted for tenants
      },
      // Include redirect info for frontend
      redirect: customer.merchant_id 
        ? SAAS_PORTAL_HOME
        : (customer.customer_type === 'api' ? '/docs' : SAAS_PORTAL_HOME)
    });
  } catch (error) {
    console.error('❌ Customer login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
      message: error.message
    });
  }
});

/**
 * POST /api/signin/verify
 * Verify sign-in code and create session
 */
router.post('/signin/verify', rateLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: 'Email and verification code are required'
      });
    }

    // Verify code
    const verification = db.verifyEmailCode(email, code);
    if (!verification) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification code',
        message: 'The verification code is incorrect or has expired. Please request a new code.'
      });
    }

    // Get customer
    const customer = db.getCustomer(verification.customer_id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Create session
    const sessionId = db.createCustomerSession(
      customer.id,
      req.ip,
      req.get('user-agent')
    );

    // Set session cookie
    res.cookie('customer_session', sessionId, getSessionCookieOptions(req));

    // Check what the next step should be
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    const customerType = customer.customer_type || 'saas'; // Default to saas

    let nextStep = customerType === 'saas' ? 'dashboard' : 'docs';
    let redirect = customerType === 'saas' ? SAAS_PORTAL_HOME : '/docs';

    if (!termsAccepted) {
      nextStep = 'terms';
      redirect = '/terms';
    } else if (!customer.card_verified) {
      nextStep = 'verify_card';
      redirect = '/verify-card';
    }

    res.json({
      success: true,
      message: 'Signed in successfully',
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        email_verified: customer.email_verified === 1
      },
      next_step: nextStep,
      redirect: redirect
    });
  } catch (error) {
    console.error('❌ Sign-in verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify sign-in',
      message: error.message
    });
  }
});

/**
 * POST /api/signup/resend-code
 * Resend verification code
 */
router.post('/signup/resend-code', rateLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Check if customer exists
    const customer = db.getCustomerByEmail(email);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        message: 'Please sign up first'
      });
    }

    // Check if already verified
    if (customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email already verified',
        message: 'Your email is already verified. You can proceed to accept terms.'
      });
    }

    // Check rate limit (max 5 codes per hour to prevent spam)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentCodes = db.db.prepare(`
      SELECT COUNT(*) as count FROM email_verification_codes 
      WHERE email = ? AND created_at > ?
    `).get(email, oneHourAgo);

    if (recentCodes && recentCodes.count >= 5) {
      return res.status(429).json({
        success: false,
        error: 'Too many verification requests',
        message: 'You have reached the maximum number of verification codes (5 per hour). Please wait before requesting another code to prevent spam.'
      });
    }

    // Generate new code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    db.createEmailVerificationCode(email, verificationCode, customer.id);

    // Send email
    try {
      await EmailService.sendVerificationCode(email, verificationCode, customer.name);
    } catch (emailError) {
      console.error('❌ Failed to send verification email:', emailError);
      return res.status(500).json({
        success: false,
        error: 'Failed to send verification email',
        message: 'Please try again later'
      });
    }

    res.json({
      success: true,
      message: 'Verification code resent to your email'
    });
  } catch (error) {
    console.error('❌ Resend code error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resend code',
      message: error.message
    });
  }
});

// Note: GET /terms is handled in server.js directly

/**
 * POST /api/signup/accept-terms
 * Accept terms of service
 */
router.post('/signup/accept-terms', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Session required',
        message: 'Please complete signup first'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session',
        message: 'Please sign up again'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified',
        message: 'Please verify your email first'
      });
    }

    // Check if already accepted
    const existingAcceptance = db.hasAcceptedTerms(customer.id, '1.0');
    if (existingAcceptance) {
      // Already accepted - redirect based on customer type
      // CRITICAL: Use query param if provided (user just selected), otherwise use DB value
      const customerTypeFromQuery = req.query.customer_type;
      const customerType = customerTypeFromQuery || customer.customer_type || 'saas';

      // CRITICAL: SaaS → Dashboard, API → Docs
      let defaultRedirect;
      if (customerType === 'saas') {
        defaultRedirect = SAAS_PORTAL_HOME;
      } else if (customerType === 'api') {
        defaultRedirect = '/docs';
      } else {
        defaultRedirect = SAAS_PORTAL_HOME;
      }

      const redirectUrl = req.query.redirect || defaultRedirect;
      console.log(`✅ Terms already accepted - customer_type: ${customerType}, redirect: ${redirectUrl}`);
      return res.json({
        success: true,
        message: 'Terms already accepted',
        redirect: redirectUrl
      });
    }

    // Accept terms
    db.acceptTerms(
      customer.id,
      '1.0',
      req.ip,
      req.get('user-agent')
    );

    // Update incomplete signup progress (Step 3: Terms Accepted)
    try {
      const incompleteSignup = db.getIncompleteSignupByEmail(customer.email);
      if (incompleteSignup) {
        db.updateIncompleteSignup(incompleteSignup.id, {
          signup_step: 'terms_accepted',
          last_step_completed_at: new Date().toISOString()
        });
        console.log(`📝 Updated incomplete signup for ${customer.email} (step: terms_accepted)`);
      }
    } catch (incompleteError) {
      console.warn('⚠️  Failed to update incomplete signup:', incompleteError.message);
    }

    // Get customer type from query param or customer record
    // CRITICAL: Query param takes priority if provided (user just selected it)
    // Otherwise use DB value, default to 'saas'
    const customerTypeFromQuery = req.query.customer_type;
    let customerType;

    if (customerTypeFromQuery && (customerTypeFromQuery === 'api' || customerTypeFromQuery === 'saas')) {
      // Query param provided - use it and update DB
      customerType = customerTypeFromQuery;
      if (customer.customer_type !== customerType) {
        db.updateCustomer(customer.id, { customer_type: customerType });
        customer.customer_type = customerType;
        console.log(`✅ Updated customer_type to ${customerType} for customer ${customer.id}`);
      }
    } else {
      // No query param - use DB value, default to 'saas'
      customerType = customer.customer_type || 'saas';
    }

    // Log for debugging
    console.log(`📝 Accept-terms: customer_type from DB: ${customer.customer_type || 'null'}, from query: ${customerTypeFromQuery || 'null'}, final: ${customerType}`);

    // W2-04: merchant + clinic in one transaction
    let merchantId = customer.merchant_id;
    let clinicId = null;
    if (!merchantId || customerType === 'saas') {
      try {
        const { provisionSaasTenant } = require('../services/saas-tenant-provision');
        const enabledPlatforms = customerType === 'saas'
          ? ['voice']
          : ['acp', 'ap2', 'voice'];
        const provisioned = provisionSaasTenant(db, {
          customerId: customer.id,
          clinicName: customer.company_name || customer.name,
          phone: customer.phone_number || customer.twilio_phone_number,
          email: customer.email,
          customerType,
          enabledPlatforms
        });
        merchantId = provisioned.merchantId;
        clinicId = provisioned.clinicId;
        customer.merchant_id = merchantId;
        console.log(`✅ Provisioned tenant merchant=${merchantId} clinic=${clinicId}`);
      } catch (provisionError) {
        console.error('❌ Failed to provision SaaS tenant:', provisionError);
        const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
        if (isProduction) {
          console.error('❌ CRITICAL: Tenant provisioning failed in production');
        }
      }
    } else {
      console.log(`✅ Customer ${customer.id} already has merchant ${merchantId}`);
    }

    const { isTrialSimEnabledForCustomer } = require('../services/trial-lifecycle');
    const simTrialOn = customerType === 'saas' && isTrialSimEnabledForCustomer(customer);

    // Allocate free credits based on customer type (skip if SIM trial already granted on phone verify)
    try {
      if (customerType === 'saas' && !simTrialOn) {
        const { getSignupTrialMinutes } = require('../services/plan-catalog');
        const trialMin = getSignupTrialMinutes();
        db.allocateFreeCredits(customer.id, trialMin);
        console.log(`✅ Allocated ${trialMin} free minutes (SaaS) to customer ${customer.id}`);
      } else if (customerType === 'saas' && simTrialOn && customer.trial_status !== 'active') {
        const { getSignupTrialMinutes } = require('../services/plan-catalog');
        db.allocateFreeCredits(customer.id, getSignupTrialMinutes());
      } else if (customerType !== 'saas') {
        // API customers get 100 free minutes (one-time)
        db.allocateFreeCredits(customer.id, 100);
        console.log(`✅ Allocated 100 free minutes (API) to customer ${customer.id}`);
      }
    } catch (creditsError) {
      console.error('❌ Failed to allocate free credits:', creditsError);
      // Continue - credits can be allocated later
    }

    // Create Retell agent for customer when they accept terms
    let retellAgentId = null;
    let retellAgentStatus = 'pending';

    // Only create agent if customer doesn't already have one (SIM trial may have created on phone verify)
    if (!customer.retell_agent_id) {
      try {
        const retellService = new RetellService();
        const agentResult = await retellService.createAgent({
          name: customer.company_name || customer.name,
          phone_number: customer.phone_number || null
        });

        if (agentResult.success) {
          retellAgentId = agentResult.agent_id;
          retellAgentStatus = 'active';
          db.updateCustomerRetellAgent(customer.id, retellAgentId, retellAgentStatus);
          console.log(`✅ Created Retell agent ${retellAgentId} for customer ${customer.id}`);
        } else {
          console.warn(`⚠️  Retell agent creation failed for customer ${customer.id}:`, agentResult.error);
          // Continue - agent can be created later
        }
      } catch (retellError) {
        console.error('❌ Retell agent creation error:', retellError);
        // Continue - agent can be created later
      }
    } else {
      // Customer already has an agent
      retellAgentId = customer.retell_agent_id;
      retellAgentStatus = customer.retell_agent_status || 'active';
    }

    // For SaaS customers: Provision Twilio phone number
    let twilioPhoneNumber = null;
    let twilioPhoneSid = null;

    if (customerType === 'saas' && !customer.twilio_phone_number && !simTrialOn) {
      try {
        const { canProvisionNumber } = require('../services/billing-access');
        const provisionGate = canProvisionNumber(db, customer.id);
        if (!provisionGate.allowed) {
          console.log(`📞 Deferring Twilio provision until payment (${provisionGate.reason})`);
        }

        const twilioPhoneService = new TwilioPhoneService();

        if (provisionGate.allowed && twilioPhoneService.isAvailable()) {
          // Build webhook URL with customer_id parameter
          const apiBaseUrl = process.env.API_BASE_URL || process.env.BASE_URL ||
            (process.env.NODE_ENV === 'production' ? 'https://api.myskinandcare.com' : 'http://localhost:4000');
          const webhookUrl = `${apiBaseUrl}/voice/incoming?customer_id=${customer.id}`;

          // Extract area code from customer's phone number if available
          // US phone numbers: +1XXXXXXXXXX or 1XXXXXXXXXX or XXXXXXXXXX
          // Area code is the first 3 digits after country code (1)
          let areaCode = null;
          if (customer.phone_number) {
            // Remove all non-digit characters
            const digitsOnly = customer.phone_number.replace(/\D/g, '');
            // If starts with 1 (US country code), area code is digits 2-4
            // Otherwise, area code is first 3 digits
            if (digitsOnly.length >= 10) {
              if (digitsOnly.startsWith('1') && digitsOnly.length === 11) {
                areaCode = digitsOnly.substring(1, 4); // Skip country code, get next 3 digits
              } else if (digitsOnly.length === 10) {
                areaCode = digitsOnly.substring(0, 3); // First 3 digits
              }
            }
            // Validate area code is 3 digits and doesn't start with 0 or 1
            if (areaCode && (areaCode.length !== 3 || areaCode.startsWith('0') || areaCode.startsWith('1'))) {
              areaCode = null; // Invalid area code
            }
          }

          console.log(`📞 Provisioning Twilio phone number for SaaS customer ${customer.id}...`);
          const provisionedPhone = await twilioPhoneService.provisionPhoneNumberForCustomer({
            customerId: customer.id,
            areaCode: areaCode || null,
            webhookUrl: webhookUrl
          });

          twilioPhoneNumber = provisionedPhone.phoneNumber;
          twilioPhoneSid = provisionedPhone.sid;

          // Update customer with Twilio phone details
          db.updateCustomer(customer.id, {
            twilio_phone_number: twilioPhoneNumber,
            twilio_phone_sid: twilioPhoneSid
          });

          console.log(`✅ Provisioned Twilio phone number ${twilioPhoneNumber} for customer ${customer.id}`);
        } else {
          console.warn('⚠️  Twilio not configured - cannot provision phone number for SaaS customer');
        }
      } catch (twilioError) {
        console.error('❌ Failed to provision Twilio phone number:', twilioError);
        // Continue - phone can be provisioned later manually
      }
    } else if (customerType === 'saas' && customer.twilio_phone_number) {
      // Customer already has a Twilio phone number
      twilioPhoneNumber = customer.twilio_phone_number;
      twilioPhoneSid = customer.twilio_phone_sid;
    }

    // REQUIRED: Check if payment method is verified (MANDATORY for all accounts)
    const hasPaymentMethod = customer.stripe_payment_method_id && customer.card_verified === 1;

    // Determine redirect URL based on customer type
    let redirectUrl;
    const { getSignupTrialMinutes } = require('../services/plan-catalog');
    const creditsAllocated = customerType === 'saas' ? getSignupTrialMinutes() : 100;

    const refreshedCustomer = db.getCustomer(customer.id);
    const needsVoiceSubscription =
      customerType === 'saas' &&
      refreshedCustomer.subscription_status !== 'active' &&
      !refreshedCustomer.stripe_subscription_id;

    if (simTrialOn && !refreshedCustomer.phone_verified) {
      redirectUrl =
        '/signup?step=phone&redirect=' + encodeURIComponent('/terms?customer_type=saas');
      console.log('✅ SIM trial — phone verification required');
    } else if (simTrialOn && refreshedCustomer.trial_status === 'active') {
      const welcome = refreshedCustomer.trial_welcome_dismissed_at ? '' : '?welcome=1';
      redirectUrl = `/business/trial-activation.html${welcome}`;
      console.log('✅ SIM trial active — redirect to trial activation');
    } else if (needsVoiceSubscription) {
      redirectUrl = '/business/settings.html?billing=subscribe';
      console.log('✅ SaaS signup — redirect to voice plan checkout');
    } else if (hasPaymentMethod) {
      redirectUrl = '/signup-complete';
      console.log(`✅ Payment verified - redirecting to signup complete page`);
    } else {
      redirectUrl = `/verify-card?customer_type=${customerType}`;
      console.log(`✅ Payment required - redirecting to verify-card`);
    }

    res.json({
      success: true,
      message: hasPaymentMethod ? 'Terms accepted successfully' : 'Terms accepted. Payment verification required.',
      redirect: redirectUrl,
      credits_allocated: creditsAllocated,
      retell_agent_id: retellAgentId,
      retell_agent_status: retellAgentStatus,
      customer_type: customerType,
      twilio_phone_number: twilioPhoneNumber,
      twilio_phone_sid: twilioPhoneSid,
      merchant_id: merchantId, // Return merchant_id to frontend
      requires_card_verification: !hasPaymentMethod,
      payment_verification_required: !hasPaymentMethod // Explicit flag that payment verification is required
    });
  } catch (error) {
    console.error('❌ Accept terms error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to accept terms',
      message: error.message
    });
  }
});

/**
 * POST /api/customers/me/api-keys
 * Create API key for authenticated customer
 */
router.post('/customers/me/api-keys', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Please sign up and accept terms first'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'Please accept the terms of service first'
      });
    }

    // Generate API key
    const { generateApiKey, hashApiKey, encryptApiKey } = require('../utils/api-keys');
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    const keyPrefix = apiKey.substring(0, 12); // First 12 chars for display
    const encryptedKey = encryptApiKey(apiKey); // Encrypt for admin recovery

    const apiKeyId = `key_${uuidv4()}`;
    db.createAPIKey({
      id: apiKeyId,
      customer_id: customer.id,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      key_secret: encryptedKey, // Store encrypted full key for admin recovery
      rate_limit_tier: 'starter',
      is_active: true
    });

    // Return API key (only time it's shown in full)
    res.json({
      success: true,
      api_key: apiKey,
      key_prefix: keyPrefix,
      key_id: apiKeyId,
      message: 'API key created successfully. Save this key securely - it will not be shown again.',
      warning: 'This is the only time you will see your full API key. Store it securely.'
    });
  } catch (error) {
    console.error('❌ Create API key error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create API key',
      message: error.message
    });
  }
});

/**
 * GET /api/customers/me/api-keys
 * List customer's API keys (masked)
 */
router.get('/customers/me/api-keys', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    // MANDATORY: Check if terms accepted
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before accessing API keys. Please visit /terms to accept.'
      });
    }

    const keys = db.getCustomerAPIKeys(session.customer_id);
    res.json({
      success: true,
      api_keys: keys.map(key => ({
        id: key.id,
        key_prefix: key.key_prefix,
        created_at: key.created_at,
        last_used_at: key.last_used_at,
        is_active: key.is_active === 1
      }))
    });
  } catch (error) {
    console.error('❌ Get API keys error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve API keys',
      message: error.message
    });
  }
});

/**
 * GET /api/customers/me/availability-status
 * Get current provider's online/offline status (session-based)
 */
router.get('/customers/me/availability-status', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const status = ProviderService.getProviderStatus(customer.email);
    res.json({
      success: true,
      status: status || { is_online: false, availability_rules: null, updated_at: null }
    });
  } catch (error) {
    console.error('❌ Get availability status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/customers/me/availability-blocks
 * List availability blocks for the session provider
 */
router.get('/customers/me/availability-blocks', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const startDate = req.query.start;
    const endDate = req.query.end;
    const blocks = ProviderService.getAvailabilityBlocks(customer.email, startDate || undefined, endDate || undefined);
    res.json({ success: true, blocks });
  } catch (error) {
    console.error('❌ Get availability blocks error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/customers/me/availability-blocks
 * Create availability block (available or out_of_office)
 */
router.post('/customers/me/availability-blocks', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const { block_type, start_datetime, end_datetime, title } = req.body || {};
    if (!block_type || !['available', 'out_of_office'].includes(block_type)) {
      return res.status(400).json({ success: false, error: 'block_type must be "available" or "out_of_office"' });
    }
    if (!start_datetime || !end_datetime) {
      return res.status(400).json({ success: false, error: 'start_datetime and end_datetime required' });
    }
    const block = ProviderService.createAvailabilityBlock({
      provider_email: customer.email,
      block_type,
      start_datetime,
      end_datetime,
      title: title || null
    });
    res.json({ success: true, block });
  } catch (error) {
    console.error('❌ Create availability block error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/customers/me/availability-blocks/:id
 * Delete availability block
 */
router.delete('/customers/me/availability-blocks/:id', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const deleted = ProviderService.deleteAvailabilityBlock(customer.email, req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Block not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Delete availability block error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/customers/me/availability-status
 * Set provider online/offline (session-based)
 */
router.patch('/customers/me/availability-status', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const { is_online } = req.body || {};
    if (typeof is_online === 'boolean') {
      ProviderService.setProviderOnline(customer.email, is_online);
    }
    const status = ProviderService.getProviderStatus(customer.email);
    res.json({ success: true, status });
  } catch (error) {
    console.error('❌ Update availability status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/customers/me
 * Get current customer information
 */
router.get('/customers/me', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    if (!customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified',
        message: 'Please verify your email first'
      });
    }

    // MANDATORY: Check if terms accepted (user must accept terms before accessing profile)
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before accessing your profile. Please visit /terms to accept.'
      });
    }

    // Parse api_features if it's a JSON string
    let apiFeatures = customer.api_features;
    if (typeof apiFeatures === 'string' && apiFeatures) {
      try {
        apiFeatures = JSON.parse(apiFeatures);
      } catch (e) {
        apiFeatures = [];
      }
    } else if (!apiFeatures) {
      apiFeatures = [];
    }

    // Parse provider_profile if present (specialist portal data)
    let providerProfile = customer.provider_profile;
    if (typeof providerProfile === 'string' && providerProfile) {
      try {
        providerProfile = JSON.parse(providerProfile);
      } catch (e) {
        providerProfile = null;
      }
    }

    res.json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone_number: customer.phone_number,
        twilio_phone_number: customer.twilio_phone_number || null,
        company_name: customer.company_name,
        business_size: customer.business_size,
        api_features: apiFeatures,
        provider_profile: providerProfile || null,
        plan_tier: customer.plan_tier,
        status: customer.status,
        email_verified: customer.email_verified === 1,
        retell_agent_id: customer.retell_agent_id,
        retell_agent_status: customer.retell_agent_status,
        stripe_customer_id: customer.stripe_customer_id || null,
        merchant_id: customer.merchant_id || null,
        password_updated_at: customer.password_updated_at || null,
        created_at: customer.created_at
      }
    });
  } catch (error) {
    console.error('❌ Get customer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve customer information',
      message: error.message
    });
  }
});

/**
 * PATCH /api/customers/me/profile
 * Update editable profile fields for current customer.
 */
router.patch('/customers/me/profile', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    const customer = db.getCustomer(session.customer_id);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const body = req.body || {};
    const updates = {};
    const before = {
      company_name: customer.company_name || null,
      phone_number: customer.phone_number || null,
      provider_profile: customer.provider_profile || null
    };

    if (typeof body.company_name === 'string') {
      updates.company_name = body.company_name.trim().slice(0, 200);
    }
    if (typeof body.phone_number === 'string') {
      updates.phone_number = body.phone_number.trim().slice(0, 50);
    }
    if (body.provider_profile && typeof body.provider_profile === 'object') {
      let existingProfile = null;
      if (typeof customer.provider_profile === 'string' && customer.provider_profile) {
        try { existingProfile = JSON.parse(customer.provider_profile); } catch (_) { existingProfile = null; }
      } else if (customer.provider_profile && typeof customer.provider_profile === 'object') {
        existingProfile = customer.provider_profile;
      }
      updates.provider_profile = JSON.stringify({
        ...(existingProfile || {}),
        ...body.provider_profile
      });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No editable fields provided' });
    }

    if (typeof updates.phone_number === 'string') {
      const normalized = updates.phone_number.replace(/[^\d+]/g, '');
      updates.phone_number = normalized.slice(0, 24);
    }
    db.updateCustomer(customer.id, updates);
    const fresh = db.getCustomer(customer.id);
    let providerProfile = fresh.provider_profile;
    if (typeof providerProfile === 'string' && providerProfile) {
      try { providerProfile = JSON.parse(providerProfile); } catch (_) { providerProfile = null; }
    }

    try {
      db.db.prepare(`
        INSERT INTO customer_profile_audit (id, customer_id, action, before_json, after_json, actor_ip, actor_user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        `cpa_${require('crypto').randomBytes(8).toString('hex')}`,
        customer.id,
        'profile_update',
        JSON.stringify(before),
        JSON.stringify(updates),
        req.ip || null,
        req.get('user-agent') || null
      );
    } catch (_) {}

    return res.json({
      success: true,
      customer: {
        id: fresh.id,
        name: fresh.name,
        email: fresh.email,
        phone_number: fresh.phone_number,
        company_name: fresh.company_name,
        provider_profile: providerProfile || null
      }
    });
  } catch (error) {
    console.error('❌ Update customer profile error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update profile', message: error.message });
  }
});

router.get('/customers/me/notification-settings', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const row = db.db.prepare(`
      SELECT * FROM customer_notification_settings WHERE customer_id = ?
    `).get(customerId) || {
      customer_id: customerId,
      order_notifications: 1,
      fraud_alerts: 1,
      weekly_reports: 1
    };
    res.json({
      success: true,
      settings: {
        order_notifications: !!row.order_notifications,
        fraud_alerts: !!row.fraud_alerts,
        weekly_reports: !!row.weekly_reports
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/customers/me/notification-settings', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const body = req.body || {};
    const next = {
      order_notifications: body.order_notifications === false ? 0 : 1,
      fraud_alerts: body.fraud_alerts === false ? 0 : 1,
      weekly_reports: body.weekly_reports === false ? 0 : 1
    };
    db.db.prepare(`
      INSERT INTO customer_notification_settings (customer_id, order_notifications, fraud_alerts, weekly_reports, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(customer_id) DO UPDATE SET
        order_notifications = excluded.order_notifications,
        fraud_alerts = excluded.fraud_alerts,
        weekly_reports = excluded.weekly_reports,
        updated_at = CURRENT_TIMESTAMP
    `).run(customerId, next.order_notifications, next.fraud_alerts, next.weekly_reports);
    try {
      db.db.prepare(`
        INSERT INTO customer_profile_audit (id, customer_id, action, before_json, after_json, actor_ip, actor_user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        `cpa_${require('crypto').randomBytes(8).toString('hex')}`,
        customerId,
        'notification_settings_update',
        null,
        JSON.stringify(next),
        req.ip || null,
        req.get('user-agent') || null
      );
    } catch (_) {}
    res.json({
      success: true,
      settings: {
        order_notifications: !!next.order_notifications,
        fraud_alerts: !!next.fraud_alerts,
        weekly_reports: !!next.weekly_reports
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/customers/me/sessions', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const currentSession = req.cookies?.customer_session || null;
    const sessions = db.db.prepare(`
      SELECT id, ip_address, user_agent, created_at, last_accessed_at, expires_at
      FROM customer_sessions
      WHERE customer_id = ? AND expires_at > datetime('now')
      ORDER BY datetime(last_accessed_at) DESC, datetime(created_at) DESC
      LIMIT 20
    `).all(customerId);
    res.json({
      success: true,
      sessions: sessions.map((s) => ({ ...s, is_current: currentSession === s.id }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/customers/me/sessions/:id', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const sessionId = String(req.params.id || '').trim();
    if (!sessionId) return res.status(400).json({ success: false, error: 'Session id required' });
    const row = db.db.prepare(`SELECT id FROM customer_sessions WHERE id = ? AND customer_id = ?`).get(sessionId, customerId);
    if (!row) return res.status(404).json({ success: false, error: 'Session not found' });
    db.deleteCustomerSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/customers/me/sessions/revoke-others', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const currentSession = req.cookies?.customer_session || '';
    db.db.prepare(`
      DELETE FROM customer_sessions
      WHERE customer_id = ? AND id != ?
    `).run(customerId, currentSession);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/customers/me/email-change/request', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customer = req.customer;
    const newEmail = String(req.body?.new_email || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }
    if (newEmail === String(customer.email || '').toLowerCase()) {
      return res.status(400).json({ success: false, error: 'New email must be different' });
    }
    const existing = db.getCustomerByEmail(newEmail);
    if (existing && existing.id !== customer.id) {
      return res.status(409).json({ success: false, error: 'Email already in use' });
    }
    db.db.prepare(`UPDATE email_change_requests SET status = 'cancelled' WHERE customer_id = ? AND status = 'pending'`).run(customer.id);
    const reqId = `ecr_${require('crypto').randomBytes(8).toString('hex')}`;
    db.db.prepare(`
      INSERT INTO email_change_requests (id, customer_id, old_email, new_email, status, requested_at, expires_at)
      VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, datetime('now', '+30 minutes'))
    `).run(reqId, customer.id, customer.email, newEmail);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    db.createEmailVerificationCode(newEmail, code, customer.id);
    try { await EmailService.sendVerificationCode(newEmail, code); } catch (_) {}
    res.json({ success: true, message: 'Verification code sent to new email' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/customers/me/email-change/confirm', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customer = req.customer;
    const newEmail = String(req.body?.new_email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    if (!newEmail || !code) return res.status(400).json({ success: false, error: 'new_email and code required' });
    const reqRow = db.db.prepare(`
      SELECT * FROM email_change_requests
      WHERE customer_id = ? AND new_email = ? AND status = 'pending' AND expires_at > datetime('now')
      ORDER BY requested_at DESC LIMIT 1
    `).get(customer.id, newEmail);
    if (!reqRow) return res.status(400).json({ success: false, error: 'No pending request for this email' });
    const verification = db.verifyEmailCode(newEmail, code);
    if (!verification) return res.status(400).json({ success: false, error: 'Invalid or expired code' });
    db.updateCustomer(customer.id, { email: newEmail, email_verified: 1 });
    db.db.prepare(`
      UPDATE email_change_requests
      SET status = 'verified', verified_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(reqRow.id);
    try {
      db.db.prepare(`
        INSERT INTO customer_profile_audit (id, customer_id, action, before_json, after_json, actor_ip, actor_user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        `cpa_${require('crypto').randomBytes(8).toString('hex')}`,
        customer.id,
        'email_change_confirmed',
        JSON.stringify({ email: customer.email }),
        JSON.stringify({ email: newEmail }),
        req.ip || null,
        req.get('user-agent') || null
      );
    } catch (_) {}
    res.json({ success: true, email: newEmail });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/customers/me/services-status', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customer = req.customer;
    const merchant = customer?.merchant_id ? db.getMerchant(customer.merchant_id) : null;
    res.json({
      success: true,
      services: {
        stripe: {
          connected: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim()),
          detail: customer?.stripe_customer_id ? `Customer ${customer.stripe_customer_id}` : 'Not linked yet'
        },
        twilio: {
          connected: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
          detail: customer?.twilio_phone_number || 'No number assigned'
        },
        google_calendar: { connected: false, detail: 'See Google Calendar card below' },
        shopify: { connected: false, detail: merchant?.api_url || 'Not connected' }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/customers/me/export
 * Request a data export (returns JSON summary of account data)
 */
router.post('/customers/me/export', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customer = req.customer;
    const customerId = customer.id;

    const customerRow = db.getCustomer(customerId);
    const merchant = customerRow?.merchant_id ? db.getMerchant(customerRow.merchant_id) : null;
    const invoices = db.getCustomerInvoices ? db.getCustomerInvoices(customerId) : [];
    const notifSettings = db.db.prepare('SELECT * FROM customer_notification_settings WHERE customer_id = ?').get(customerId);
    const credits = db.db.prepare('SELECT * FROM customer_credits WHERE customer_id = ?').get(customerId);

    const exportData = {
      exported_at: new Date().toISOString(),
      customer: customerRow ? {
        id: customerRow.id,
        name: customerRow.name,
        email: customerRow.email,
        company_name: customerRow.company_name,
        phone_number: customerRow.phone_number,
        plan_tier: customerRow.plan_tier,
        created_at: customerRow.created_at
      } : null,
      merchant: merchant ? {
        id: merchant.id,
        name: merchant.name,
        webhook_url: merchant.webhook_url,
        created_at: merchant.created_at
      } : null,
      invoices: (invoices || []).slice(0, 50).map(inv => ({
        invoice_number: inv.invoice_number,
        billing_month: inv.billing_month,
        total: inv.total,
        status: inv.status,
        due_date: inv.due_date
      })),
      notification_settings: notifSettings || null,
      credits: credits || null
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="doclittle-export-${customerId}-${Date.now()}.json"`);
    res.send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: 'Failed to export data', message: error.message });
  }
});

/**
 * POST /api/customers/me/close-account
 * Soft-close account (sets status to closed, revokes all sessions)
 */
router.post('/customers/me/close-account', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const customer = req.customer;
    const { confirm_phrase } = req.body || {};
    if (confirm_phrase !== 'DELETE FOREVER') {
      return res.status(400).json({
        success: false,
        error: 'You must type DELETE FOREVER to confirm account closure'
      });
    }

    db.updateCustomer(customer.id, { status: 'closed', updated_at: new Date().toISOString() });
    db.db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(customer.id);

    try {
      db.db.prepare(`
        INSERT INTO customer_profile_audit (id, customer_id, action, before_json, after_json, actor_ip, actor_user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        `cpa_${require('crypto').randomBytes(8).toString('hex')}`,
        customer.id,
        'account_closed',
        JSON.stringify({ status: customer.status }),
        JSON.stringify({ status: 'closed' }),
        req.ip || null,
        req.get('user-agent') || null
      );
    } catch (_) {}

    res.json({
      success: true,
      message: 'Account closed. You have been signed out.'
    });
  } catch (error) {
    console.error('Close account error:', error);
    res.status(500).json({ success: false, error: 'Failed to close account', message: error.message });
  }
});

/**
 * GET /api/customers/me/feature-requests
 * Get customer's feature request history
 */
router.get('/customers/me/feature-requests', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    // MANDATORY: Check if terms accepted
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before accessing feature requests. Please visit /terms to accept.'
      });
    }

    const requests = db.getCustomerFeatureRequests(session.customer_id);
    res.json({
      success: true,
      requests: requests || []
    });
  } catch (error) {
    console.error('❌ Get feature requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve feature requests',
      message: error.message
    });
  }
});

/**
 * POST /api/customers/me/feature-requests
 * Create new feature requests
 */
router.post('/customers/me/feature-requests', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const { features } = req.body;
    if (!features || !Array.isArray(features) || features.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an array of features to request'
      });
    }

    // Get current customer to check existing features
    const customer = db.getCustomer(session.customer_id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    if (!customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    // MANDATORY: Check if terms accepted
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before submitting feature requests. Please visit /terms to accept.'
      });
    }

    // Parse existing features
    let existingFeatures = customer.api_features;
    if (typeof existingFeatures === 'string' && existingFeatures) {
      try {
        existingFeatures = JSON.parse(existingFeatures);
      } catch (e) {
        existingFeatures = [];
      }
    } else if (!existingFeatures) {
      existingFeatures = [];
    }

    // Filter out features they already have
    const newFeatures = features.filter(f => !existingFeatures.includes(f));

    if (newFeatures.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'You already have access to all selected features'
      });
    }

    // Create feature requests
    const createdRequests = [];
    for (const featureName of newFeatures) {
      try {
        db.createFeatureRequest(session.customer_id, featureName, null, null);
        createdRequests.push(featureName);
      } catch (error) {
        console.error(`Failed to create feature request for ${featureName}:`, error);
      }
    }

    // Send email notification to admin if requests were created
    if (createdRequests.length > 0) {
      try {
        const EmailService = require('../services/email-service');
        await EmailService.sendFeatureRequestNotification(
          customer.email,
          customer.name || customer.company_name || 'Customer',
          createdRequests,
          customer.company_name || 'N/A'
        );
        console.log(`📧 Feature request notification sent for ${createdRequests.length} feature(s) from ${customer.email}`);
      } catch (emailError) {
        console.error('⚠️  Failed to send feature request notification:', emailError);
        // Don't fail the request if email fails
      }
    }

    res.json({
      success: true,
      message: `Successfully requested ${createdRequests.length} feature(s)`,
      requested_features: createdRequests
    });
  } catch (error) {
    console.error('❌ Create feature requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create feature requests',
      message: error.message
    });
  }
});

/**
 * GET /api/signup/stripe-config
 * Get Stripe publishable key for frontend
 */
router.get('/signup/stripe-config', rateLimiter, async (req, res) => {
  try {
    const stripeConfig = require('../utils/stripe-config');
    const publishableKey = stripeConfig.getStripePublishableKey();
    const mode = stripeConfig.getStripeMode();

    res.json({
      success: true,
      publishable_key: publishableKey,
      mode: mode // 'production' or 'test' - useful for frontend to show appropriate messages
    });
  } catch (error) {
    console.error('❌ Stripe config error:', error);
    res.status(500).json({
      success: false,
      error: 'Stripe not configured',
      message: error.message
    });
  }
});

/**
 * GET /api/customers/me/payment-method
 * Get customer's stored payment method
 */
router.get('/customers/me/payment-method', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified'
      });
    }

    // MANDATORY: Check if terms accepted
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'You must accept the terms of service before accessing payment method. Please visit /terms to accept.'
      });
    }

    const paymentMethod = db.getCustomerPaymentMethod(session.customer_id);

    res.json({
      success: true,
      payment_method: paymentMethod || null
    });
  } catch (error) {
    console.error('❌ Get payment method error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment method',
      message: error.message
    });
  }
});

/**
 * POST /api/signup/verify-card
 * Save card details without charging (Stripe account under review)
 * We'll charge users later once Stripe is approved
 */
router.post('/signup/verify-card', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Please complete signup first'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session',
        message: 'Please sign up again'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified',
        message: 'Please verify your email first'
      });
    }

    // Check if Stripe is configured
    if (!stripe) {
      return res.status(500).json({
        success: false,
        error: 'Stripe not configured',
        message: 'Payment processing is not available'
      });
    }

    const { payment_method_id, card_details, skip_stripe } = req.body;

    // If Stripe is disabled or account is under review, save without payment method ID
    if (skip_stripe || !payment_method_id) {
      console.log('⚠️  Skipping Stripe payment method creation (account under review or disabled)');

      // Save placeholder payment method to allow API access
      // We'll update with real details once Stripe account is approved
      const placeholderId = `pm_placeholder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      db.updateCustomerPaymentMethod(
        customer.id,
        placeholderId,
        card_details?.last4 || '****',
        card_details?.brand || 'card',
        true // Mark as verified so user can access API immediately
      );

      console.log(`✅ Payment method placeholder saved for customer ${customer.id} (Stripe account under review)`);

      // Mark incomplete signup as completed (Step 4: Payment Verified - COMPLETE)
      try {
        const incompleteSignup = db.getIncompleteSignupByEmail(customer.email);
        if (incompleteSignup) {
          db.markIncompleteSignupCompleted(incompleteSignup.id, customer.id);
          console.log(`✅ Marked incomplete signup as completed for ${customer.email} → customer ${customer.id}`);
        }
      } catch (incompleteError) {
        console.warn('⚠️  Failed to mark incomplete signup as completed:', incompleteError.message);
      }

      // Allocate free credits on signup completion
      try {
        const customerType = customer.customer_type || 'saas';
        // SaaS customers get 250 free minutes, API customers get 100
        const freeCredits = customerType === 'saas' ? 250 : 100;
        db.allocateFreeCredits(customer.id, freeCredits);
        console.log(`✅ Allocated ${freeCredits} free credits to customer ${customer.id} (${customerType})`);
      } catch (creditError) {
        console.error('❌ Failed to allocate free credits:', creditError);
        // Don't fail the request - credits can be allocated manually later
      }

      // Generate and hash password for customer (if not already set)
      let plainPassword = null;
      if (bcrypt) {
        const existingCustomer = db.getCustomer(customer.id);
        if (!existingCustomer.password_hash) {
          plainPassword = generateSimplePassword();
          const passwordHash = await bcrypt.hash(plainPassword, 10);
          db.updateCustomer(customer.id, { password_hash: passwordHash });
          console.log(`✅ Generated password for customer ${customer.id}`);
        } else {
          console.log(`⚠️  Customer ${customer.id} already has a password - cannot retrieve plain password`);
        }
      } else {
        console.error('❌ Cannot generate password - bcryptjs not available');
      }

      // Send welcome email with subdomain and password (async, don't block response)
      setImmediate(async () => {
        try {
          // Get merchant to get subdomain
          let subdomain = null;
          if (customer.merchant_id) {
            const merchant = db.getMerchant(customer.merchant_id);
            if (merchant && merchant.subdomain) {
              subdomain = merchant.subdomain;
            }
          }

          await EmailService.sendWelcomeEmail(
            customer.email,
            customer.name || customer.company_name,
            subdomain,
            customer.customer_type || 'saas',
            customer.merchant_id,
            plainPassword // Pass plain password to email
          );
          console.log(`✅ Welcome email sent to ${customer.email}`);
        } catch (emailError) {
          console.error('❌ Failed to send welcome email:', emailError);
          // Don't fail the request if email fails
        }
      });

      return res.json({
        success: true,
        message: 'Payment method saved successfully. You can now access the API.',
        payment_method: {
          card_brand: card_details?.brand || 'card',
          card_last4: card_details?.last4 || '****'
        },
        customer_type: customer.customer_type || 'saas', // Return customer_type for proper redirect
        note: 'Card details will be updated once your account is fully activated. No charges will be made until then.'
      });
    }

    // Retrieve payment method to get card details
    // This will work even if Stripe account is under review
    let paymentMethod;
    try {
      paymentMethod = await stripe.paymentMethods.retrieve(payment_method_id);
      if (!paymentMethod || paymentMethod.type !== 'card') {
        return res.status(400).json({
          success: false,
          error: 'Invalid payment method'
        });
      }
    } catch (stripeError) {
      // If Stripe account is under review, we might get errors
      // But we can still try to save the payment method ID
      console.warn('⚠️  Stripe error retrieving payment method (account may be under review):', stripeError.message);

      // resource_missing = PaymentMethod created in different Stripe mode (test vs live)
      // Frontend pk_live_ + backend sk_test_ (or vice versa) = pm_ doesn't exist in backend's mode
      const isResourceMissing = stripeError.code === 'resource_missing' ||
        stripeError.raw?.code === 'resource_missing' ||
        (stripeError.message && String(stripeError.message).includes('No such PaymentMethod'));
      if (isResourceMissing) {
        const isDev = process.env.NODE_ENV !== 'production';
        if (isDev) {
          // In dev: save placeholder so user can complete signup (convenience for testing)
          const placeholderId = `pm_placeholder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          db.updateCustomerPaymentMethod(
            customer.id,
            placeholderId,
            card_details?.last4 || '****',
            card_details?.brand || 'card',
            true
          );
          try {
            const incompleteSignup = db.getIncompleteSignupByEmail(customer.email);
            if (incompleteSignup) db.markIncompleteSignupCompleted(incompleteSignup.id, customer.id);
          } catch (_) {}
          try {
            const freeCredits = (customer.customer_type || 'saas') === 'saas' ? 250 : 100;
            db.allocateFreeCredits(customer.id, freeCredits);
          } catch (_) {}
          if (bcrypt) {
            const existingCustomer = db.getCustomer(customer.id);
            if (!existingCustomer.password_hash) {
              const plainPassword = generateSimplePassword();
              const passwordHash = await bcrypt.hash(plainPassword, 10);
              db.updateCustomer(customer.id, { password_hash: passwordHash });
              setImmediate(() => {
                EmailService.sendWelcomeEmail(
                  customer.email,
                  customer.name || customer.company_name,
                  null,
                  customer.customer_type || 'saas',
                  customer.merchant_id,
                  plainPassword
                ).catch(() => {});
              });
            }
          }
          return res.json({
            success: true,
            message: 'Payment method saved (dev mode – Stripe test/live keys were mismatched).',
            payment_method: { card_brand: card_details?.brand || 'card', card_last4: card_details?.last4 || '****' },
            note: 'Restart server and use pk_test_ with sk_test_ for real card verification.'
          });
        }
        return res.status(400).json({
          success: false,
          error: 'Payment method could not be verified',
          message: 'Stripe test and live keys may be mismatched. Refresh the page, enter your card again, and ensure test cards (e.g. 4242...) are used with test mode (pk_test_ / sk_test_).'
        });
      }

      // If we can't retrieve the payment method, we can't get card details
      // But we can still save the payment method ID for later use
      if (stripeError.code === 'account_invalid' || stripeError.message?.includes('cannot currently make live charges')) {
        // Account is under review - save payment method ID anyway
        // We'll retrieve details later when account is approved
        db.updateCustomerPaymentMethod(
          customer.id,
          payment_method_id,
          card_details?.last4 || '****',
          card_details?.brand || 'card',
          true // Mark as verified so user can access API
        );

        console.log(`✅ Payment method saved for customer ${customer.id} (Stripe account under review)`);

        // Generate and hash password for customer (if not already set)
        let plainPassword = null;
        if (bcrypt) {
          const existingCustomer = db.getCustomer(customer.id);
          if (!existingCustomer.password_hash) {
            plainPassword = generateSimplePassword();
            const passwordHash = await bcrypt.hash(plainPassword, 10);
            db.updateCustomer(customer.id, { password_hash: passwordHash });
            console.log(`✅ Generated password for customer ${customer.id}`);
          } else {
            console.log(`⚠️  Customer ${customer.id} already has a password - cannot retrieve plain password`);
          }
        } else {
          console.error('❌ Cannot generate password - bcryptjs not available');
        }

        // Send welcome email with subdomain and password (async, don't block response)
        setImmediate(async () => {
          try {
            // Get merchant to get subdomain
            let subdomain = null;
            if (customer.merchant_id) {
              const merchant = db.getMerchant(customer.merchant_id);
              if (merchant && merchant.subdomain) {
                subdomain = merchant.subdomain;
              }
            }

            await EmailService.sendWelcomeEmail(
              customer.email,
              customer.name || customer.company_name,
              subdomain,
              customer.customer_type || 'saas',
              customer.merchant_id,
              plainPassword // Pass plain password to email
            );
            console.log(`✅ Welcome email sent to ${customer.email}`);
          } catch (emailError) {
            console.error('❌ Failed to send welcome email:', emailError);
            // Don't fail the request if email fails
          }
        });

        return res.json({
          success: true,
          message: 'Payment method saved successfully. You can now access the API.',
          payment_method: {
            card_brand: card_details?.brand || 'card',
            card_last4: card_details?.last4 || '****'
          },
          customer_type: customer.customer_type || 'saas', // Return customer_type for proper redirect
          note: 'Card details will be updated once your account is fully activated'
        });
      }

      // For other errors, return the error
      throw stripeError;
    }

    // Successfully retrieved payment method - save it to database
    // Skip Payment Intent creation to avoid charges (Stripe account under review)
    db.updateCustomerPaymentMethod(
      customer.id,
      payment_method_id,
      paymentMethod.card.last4,
      paymentMethod.card.brand,
      true // Mark as verified so user can access API immediately
    );

    console.log(`✅ Payment method saved for customer ${customer.id}: ${paymentMethod.card.brand} ****${paymentMethod.card.last4}`);

    // Mark incomplete signup as completed (Step 4: Payment Verified - COMPLETE)
    try {
      const incompleteSignup = db.getIncompleteSignupByEmail(customer.email);
      if (incompleteSignup) {
        db.markIncompleteSignupCompleted(incompleteSignup.id, customer.id);
        console.log(`✅ Marked incomplete signup as completed for ${customer.email} → customer ${customer.id}`);
      }
    } catch (incompleteError) {
      console.warn('⚠️  Failed to mark incomplete signup as completed:', incompleteError.message);
    }

    // Allocate free credits on signup completion
    try {
      const customerType = customer.customer_type || 'saas';
      // SaaS customers get 250 free minutes, API customers get 100
      const freeCredits = customerType === 'saas' ? 250 : 100;
      db.allocateFreeCredits(customer.id, freeCredits);
      console.log(`✅ Allocated ${freeCredits} free credits to customer ${customer.id} (${customerType})`);
    } catch (creditError) {
      console.error('❌ Failed to allocate free credits:', creditError);
      // Don't fail the request - credits can be allocated manually later
    }

    // Generate and hash password for customer (if not already set)
    let plainPassword = null;
    if (bcrypt) {
      const existingCustomer = db.getCustomer(customer.id);
      if (!existingCustomer.password_hash) {
        plainPassword = generateSimplePassword();
        const passwordHash = await bcrypt.hash(plainPassword, 10);
        db.updateCustomer(customer.id, { password_hash: passwordHash });
        console.log(`✅ Generated password for customer ${customer.id}`);
      } else {
        console.log(`⚠️  Customer ${customer.id} already has a password - cannot retrieve plain password`);
      }
    } else {
      console.error('❌ Cannot generate password - bcryptjs not available');
    }

    // Send welcome email with subdomain and password (async, don't block response)
    setImmediate(async () => {
      try {
        // Get merchant to get subdomain
        let subdomain = null;
        if (customer.merchant_id) {
          const merchant = db.getMerchant(customer.merchant_id);
          if (merchant && merchant.subdomain) {
            subdomain = merchant.subdomain;
          }
        }

        await EmailService.sendWelcomeEmail(
          customer.email,
          customer.name || customer.company_name,
          subdomain,
          customer.customer_type || 'saas',
          customer.merchant_id,
          plainPassword // Pass plain password to email
        );
        console.log(`✅ Welcome email sent to ${customer.email}`);
      } catch (emailError) {
        console.error('❌ Failed to send welcome email:', emailError);
        // Don't fail the request if email fails
      }
    });

    res.json({
      success: true,
      message: 'Payment method saved successfully. You can now access the API.',
      payment_method: {
        card_brand: paymentMethod.card.brand,
        card_last4: paymentMethod.card.last4
      },
      customer_type: customer.customer_type || 'saas', // Return customer_type for proper redirect
      note: 'No charges will be made until your account is fully activated. We will invoice you monthly for usage beyond free credits.'
    });
  } catch (error) {
    console.error('❌ Card verification error:', error);

    // Handle Stripe account under review errors gracefully
    if (error.code === 'account_invalid' || error.message?.includes('cannot currently make live charges')) {
      // Still try to save the payment method ID if we have it
      const { payment_method_id } = req.body;
      if (payment_method_id) {
        try {
          const sessionId = req.cookies?.customer_session;
          if (sessionId) {
            const session = db.getCustomerSession(sessionId);
            if (session) {
              const customer = db.getCustomer(session.customer_id);
              if (customer) {
                db.updateCustomerPaymentMethod(
                  customer.id,
                  payment_method_id,
                  '****',
                  'card',
                  true
                );
                console.log(`✅ Payment method saved despite Stripe account review status`);
                return res.json({
                  success: true,
                  message: 'Payment method saved successfully. You can now access the API.',
                  payment_method: {
                    card_brand: 'card',
                    card_last4: '****'
                  },
                  customer_type: customer.customer_type || 'saas', // Return customer_type for proper redirect
                  note: 'Card details will be updated once your account is fully activated'
                });
              }
            }
          }
        } catch (saveError) {
          console.error('Failed to save payment method:', saveError);
        }
      }
    }

    res.status(500).json({
      success: false,
      error: 'Failed to save payment method',
      message: error.message || 'An error occurred while saving your payment method'
    });
  }
});

/**
 * POST /api/customers/signout
 * Sign out customer (delete session)
 */
router.post('/customers/signout', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;

    if (sessionId) {
      // Delete session from database
      db.deleteCustomerSession(sessionId);
    }

    // Clear cookie
    res.clearCookie('customer_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });

    res.json({
      success: true,
      message: 'Signed out successfully'
    });
  } catch (error) {
    console.error('❌ Sign out error:', error);
    // Still clear cookie and return success
    res.clearCookie('customer_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });
    res.json({
      success: true,
      message: 'Signed out successfully'
    });
  }
});

/**
 * POST /api/customer/landing/claim-session
 * Claim anonymous landing scan session into authenticated customer shelf.
 */
router.post('/customer/landing/claim-session', rateLimiter, requireCustomerAuth, express.json(), async (req, res) => {
  try {
    ensureClaimSessionTables();
    const landingSessionId = String(req.body?.landing_session_id || '').trim();
    if (!landingSessionId) {
      return res.status(400).json({
        success: false,
        error: 'landing_session_id required'
      });
    }

    const ipHash = crypto
      .createHash('sha256')
      .update(String(req.ip || '') + '|' + String(req.headers['x-forwarded-for'] || ''))
      .digest('hex')
      .slice(0, 24);
    const out = claimLandingSessionToCustomer({
      customerId: req.customer?.id,
      merchantId: req.customer?.merchant_id || null,
      landingSessionId,
      ipHash,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 240)
    });
    if (!out.success) {
      return res.status(Number(out.status) || 400).json({ success: false, error: out.error || 'claim_failed' });
    }
    return res.json(out);
  } catch (error) {
    console.error('❌ Claim session error:', error);
    return res.status(500).json({ success: false, error: 'claim_session_failed', message: error.message });
  }
});

/**
 * GET /api/customer/products
 * Minimal claimed scan shelf list for authenticated customer.
 */
router.get('/customer/products', rateLimiter, requireCustomerAuth, async (req, res) => {
  try {
    ensureClaimSessionTables();
    const products = listCustomerProducts({
      customerId: req.customer?.id,
      limit: req.query?.limit
    });
    return res.json({
      success: true,
      count: products.length,
      products
    });
  } catch (error) {
    console.error('❌ Customer products list error:', error);
    return res.status(500).json({ success: false, error: 'customer_products_list_failed', message: error.message });
  }
});

/**
 * POST /api/signup/update-customer-type
 * Update customer type after integration selection
 */
router.post('/signup/update-customer-type', rateLimiter, async (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Session required',
        message: 'Please complete signup first'
      });
    }

    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session',
        message: 'Please sign up again'
      });
    }

    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email not verified',
        message: 'Please verify your email first'
      });
    }

    const { customer_type } = req.body;
    if (!customer_type || !['api', 'saas'].includes(customer_type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid customer type',
        message: 'Customer type must be "api" or "saas"'
      });
    }

    // Update customer type
    db.updateCustomer(customer.id, { customer_type });

    res.json({
      success: true,
      message: 'Integration type updated',
      customer: {
        id: customer.id,
        customer_type: customer_type
      }
    });
  } catch (error) {
    console.error('❌ Update customer type error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update customer type',
      message: error.message
    });
  }
});

module.exports = router;

