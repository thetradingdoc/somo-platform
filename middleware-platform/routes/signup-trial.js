/**
 * Signup trial routes — extracted from routes/signup.js
 */
'use strict';

const express = require('express');
const router = express.Router();
const shared = require('./lib/signup-shared');
const {
  express: _express,
  crypto,
  db,
  EmailService,
  ProviderService,
  RetellService,
  TwilioPhoneService,
  uuidv4,
  signupFlowLimiter,
  signupSessionReadLimiter,
  generateSimplePassword,
  requireCustomerAuth,
  ensureClaimSessionTables,
  claimLandingSessionToCustomer,
  listCustomerProducts,
  bcrypt,
  stripe,
  SAAS_PORTAL_HOME,
  getSessionCookieOptions
} = shared;

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

function loadSignupSession(req, res) {
  const sessionId = req.cookies?.customer_session;
  if (!sessionId) {
    res.status(401).json({ success: false, error: 'Session required' });
    return null;
  }
  const session = db.getCustomerSession(sessionId);
  if (!session) {
    res.status(401).json({ success: false, error: 'Invalid session' });
    return null;
  }
  return { session, customer: db.getCustomer(session.customer_id) };
}

async function assignLineAndStartTrial(db, customer, phoneInput) {
  const { normalizePhone } = require('../services/twilio-verify-service');
  const {
    TrialProvisionError,
    isTrialSimEnabledForCustomer,
    startTrialTenant,
    canStartTrial
  } = require('../services/trial-lifecycle');

  const phone = phoneInput || customer.phone_number;
  if (!phone) {
    return {
      error: { status: 400, body: { success: false, error: 'Phone number required' } }
    };
  }

  const e164 = normalizePhone(phone);
  const now = new Date().toISOString();

  if (customer.twilio_phone_number) {
    if (Number(customer.phone_verified) !== 1) {
      db.updateCustomer(customer.id, {
        phone_number: e164,
        phone_verified: 1,
        phone_verified_at: customer.phone_verified_at || now
      });
    }
    const afterTrial = db.getCustomer(customer.id);
    const simTrialOn =
      (afterTrial.customer_type || 'saas') === 'saas' && isTrialSimEnabledForCustomer(afterTrial);
    return {
      success: true,
      line_assigned: true,
      message: 'Your dedicated Somo line is ready.',
      phone_verified: true,
      twilio_phone_number: afterTrial.twilio_phone_number,
      trial_sim_flow: simTrialOn,
      trial: {
        twilio_phone_number: afterTrial.twilio_phone_number,
        already_active: afterTrial.trial_status === 'active'
      },
      customer: serializeSignupSessionCustomer(afterTrial),
      next_step: 'accept_terms',
      idempotent: true
    };
  }

  const gate = canStartTrial(db, customer.id, e164);
  if (!gate.allowed && gate.reason === 'phone_trial_in_use') {
    return {
      error: {
        status: 409,
        body: { success: false, error: 'This phone number already has an active trial' }
      }
    };
  }

  db.updateCustomer(customer.id, {
    phone_number: e164,
    phone_verified: 1,
    phone_verified_at: now
  });

  let trial = null;
  const refreshed = db.getCustomer(customer.id);
  if (!refreshed.merchant_id && (refreshed.customer_type || 'saas') === 'saas') {
    try {
      const { provisionSaasTenant } = require('../services/saas-tenant-provision');
      provisionSaasTenant(db, {
        customerId: refreshed.id,
        clinicName: refreshed.company_name || refreshed.name,
        phone: e164,
        email: refreshed.email,
        customerType: 'saas',
        enabledPlatforms: ['voice'],
        useCase: refreshed.use_case || 'healthcare_clinic'
      });
    } catch (provisionErr) {
      console.warn('⚠️  Pre-trial tenant provision:', provisionErr.message);
    }
  }
  if (isTrialSimEnabledForCustomer(refreshed)) {
    try {
      trial = await startTrialTenant(db, customer.id, {
        phoneE164: e164,
        phoneVerifiedAt: now
      });
    } catch (err) {
      if (err instanceof TrialProvisionError) {
        try {
          const { transitionState } = require('../services/voice-onboarding-state');
          transitionState(db, customer.id, 'provisioning_failed', { error: err.message });
        } catch (_) {}
        return {
          error: {
            status: 502,
            body: { success: false, error: err.message, code: err.code, phone_verified: true }
          }
        };
      }
      throw err;
    }
    if (!trial?.twilio_phone_number) {
      return {
        error: {
          status: 502,
          body: {
            success: false,
            error: 'Dedicated clinic line could not be assigned. Please try again.',
            code: 'twilio_provision_failed',
            phone_verified: true
          }
        }
      };
    }
  }

  try {
    const incompleteSignup = db.getIncompleteSignupByEmail(refreshed.email);
    if (incompleteSignup) {
      db.updateIncompleteSignup(incompleteSignup.id, {
        signup_step: 'line_assigned',
        last_step_completed_at: now
      });
    }
  } catch (_) {}

  const afterTrial = db.getCustomer(customer.id);
  try {
    const { transitionState } = require('../services/voice-onboarding-state');
    if (afterTrial.twilio_phone_number) {
      transitionState(db, customer.id, 'line_assigned');
    }
  } catch (stateErr) {
    console.warn('⚠️  onboarding state line_assigned:', stateErr.message);
  }
  const simTrialOn =
    (afterTrial.customer_type || 'saas') === 'saas' && isTrialSimEnabledForCustomer(afterTrial);
  return {
    success: true,
    line_assigned: true,
    message: trial?.twilio_phone_number
      ? 'Your dedicated Somo line is ready.'
      : 'Contact confirmed',
    phone_verified: true,
    twilio_phone_number: trial?.twilio_phone_number || afterTrial.twilio_phone_number,
    trial_sim_flow: simTrialOn,
    trial,
    customer: serializeSignupSessionCustomer(afterTrial),
    next_step: 'accept_terms'
  };
}

router.post('/signup', signupFlowLimiter, async (req, res) => {
  try {
    const { isPilotInviteOnly } = require('../services/pilot-config');
    if (isPilotInviteOnly()) {
      return res.status(403).json({
        success: false,
        error: 'pilot_invite_only',
        message: 'Self-serve signup is closed during the pilot. Request access on the waitlist or use your invite link.',
        redirect: '/waitlist.html'
      });
    }

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
        const isOperator = existingCustomer.customer_type === 'operator';
        return res.status(409).json({
          success: false,
          error: 'Email already registered',
          message: isOperator
            ? 'This email is registered — sign in at /login'
            : 'This email is already associated with an account',
          sign_in_url: isOperator ? '/login' : '/login'
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
    try {
      const { transitionState } = require('../services/voice-onboarding-state');
      transitionState(db, customerId, 'signup_started');
    } catch (stateErr) {
      console.warn('⚠️  onboarding state signup_started:', stateErr.message);
    }

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
    const emailResult = await EmailService.sendVerificationCode(email, verificationCode, fullName);
    if (!emailResult?.success) {
      console.error('❌ Failed to send verification email:', emailResult?.error || 'unknown');
      return res.status(503).json({
        success: false,
        error: 'email_delivery_failed',
        message: 'Could not send verification email. Please try again in a moment.'
      });
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
router.post('/signup/update-email', signupFlowLimiter, async (req, res) => {
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
router.post('/signup/verify-email', signupFlowLimiter, async (req, res) => {
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
      next_step: trialSimFlow ? 'assign_line' : 'accept_terms'
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
router.post('/signup/verify-phone/send', signupFlowLimiter, async (req, res) => {
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
router.post('/signup/verify-phone/check', signupFlowLimiter, async (req, res) => {
  try {
    const loaded = loadSignupSession(req, res);
    if (!loaded) return;
    const { customer } = loaded;
    if (!customer?.email_verified) {
      return res.status(400).json({ success: false, error: 'Email not verified' });
    }

    const { phone_number, code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Verification code required' });
    }

    const { normalizePhone, checkPhoneVerification } = require('../services/twilio-verify-service');
    const e164 = normalizePhone(phone_number || customer.phone_number);
    const check = await checkPhoneVerification(e164, code);
    if (!check.approved) {
      return res.status(400).json({ success: false, error: 'Invalid or expired code' });
    }

    const result = await assignLineAndStartTrial(db, customer, e164);
    if (result.error) {
      return res.status(result.error.status).json(result.error.body);
    }

    res.json({
      ...result,
      message: result.trial?.twilio_phone_number
        ? 'Phone verified. Your dedicated line is ready.'
        : 'Phone verified',
      redirect: '/terms?customer_type=saas'
    });
  } catch (error) {
    console.error('❌ verify-phone/check:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/signup/assign-line
 * Email-verified session: assign dedicated Somo number and start SIM trial (no SMS OTP).
 */
router.post('/signup/assign-line', signupFlowLimiter, async (req, res) => {
  try {
    const loaded = loadSignupSession(req, res);
    if (!loaded) return;
    const { customer } = loaded;
    if (!customer?.email_verified) {
      return res.status(400).json({ success: false, error: 'Email not verified' });
    }

    const result = await assignLineAndStartTrial(db, customer, req.body?.phone_number);
    if (result.error) {
      return res.status(result.error.status).json(result.error.body);
    }
    res.json(result);
  } catch (error) {
    console.error('❌ assign-line:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/signup/session
 * Lightweight session snapshot for signup/portal UI (no terms gate).
 */
router.get('/signup/session', signupSessionReadLimiter, async (req, res) => {
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
    if (!customer) {
      res.clearCookie('customer_session', { path: '/' });
      return res.status(401).json({
        success: false,
        error: 'orphaned_session',
        message: 'Your signup session expired. Please start again.'
      });
    }

    const { isTrialSimEnabledForCustomer } = require('../services/trial-lifecycle');
    const trialSimFlow =
      (customer.customer_type || 'saas') === 'saas' && isTrialSimEnabledForCustomer(customer);

    res.json({
      success: true,
      customer: serializeSignupSessionCustomer(customer),
      trial_sim_flow: trialSimFlow,
      terms_accepted: db.hasAcceptedTerms(customer.id, '1.0')
    });
  } catch (error) {
    console.error('❌ signup/session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load session',
      message: error.message
    });
  }
});

/**
 * POST /api/signup/resend-code
 * Resend email verification code during signup.
 */
router.post('/signup/resend-code', signupFlowLimiter, async (req, res) => {
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
    const emailResult = await EmailService.sendVerificationCode(email, verificationCode, customer.name);
    if (!emailResult?.success) {
      console.error('❌ Failed to send verification email:', emailResult?.error || 'unknown');
      return res.status(503).json({
        success: false,
        error: 'email_delivery_failed',
        message: 'Could not send verification email. Please try again later.'
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
router.post('/signup/accept-terms', signupFlowLimiter, async (req, res) => {
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
          enabledPlatforms,
          useCase: customer.use_case || 'healthcare_clinic',
          medical_specialty: (() => {
            try {
              const pp = customer.provider_profile
                ? typeof customer.provider_profile === 'string'
                  ? JSON.parse(customer.provider_profile)
                  : customer.provider_profile
                : null;
              return pp?.medical_specialty || null;
            } catch (_) {
              return null;
            }
          })()
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
            (process.env.NODE_ENV === 'production' ? 'https://api.callsomo.com' : 'http://localhost:4000');
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

    if (simTrialOn && !refreshedCustomer.twilio_phone_number) {
      redirectUrl =
        '/signup?step=phone&redirect=' + encodeURIComponent('/terms?customer_type=saas');
      console.log('✅ SIM trial — dedicated line assignment required');
    } else if (simTrialOn && refreshedCustomer.trial_status === 'active') {
      const welcome = refreshedCustomer.trial_welcome_dismissed_at ? '' : '?welcome=1';
      redirectUrl = `/business/trial-activation.html${welcome}`;
      console.log('✅ SIM trial active — redirect to trial activation');
    } else if (needsVoiceSubscription) {
      redirectUrl = '/business/settings.html?billing=subscribe';
      console.log('✅ SaaS signup — redirect to voice plan checkout');
    } else if (hasPaymentMethod) {
      redirectUrl = customerType === 'api' ? '/docs' : '/signup-complete';
      console.log(`✅ Payment verified - redirecting to ${redirectUrl}`);
    } else {
      redirectUrl =
        customerType === 'api'
          ? '/verify-card?customer_type=api&redirect=' + encodeURIComponent('/docs')
          : `/verify-card?customer_type=${customerType}`;
      console.log(`✅ Payment required - redirecting to verify-card`);
    }

    try {
      const { transitionState } = require('../services/voice-onboarding-state');
      transitionState(db, customer.id, 'terms_accepted');
    } catch (stateErr) {
      console.warn('⚠️  onboarding state terms_accepted:', stateErr.message);
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

router.get('/signup/stripe-config', signupFlowLimiter, async (req, res) => {
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

router.post('/signup/verify-card', signupFlowLimiter, async (req, res) => {
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

router.post('/signup/update-customer-type', signupFlowLimiter, async (req, res) => {
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
