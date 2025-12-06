/**
 * SIGNUP ROUTES
 * Handles customer signup, email verification, and terms acceptance
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('../database');
const EmailService = require('../services/email-service');
const RetellService = require('../services/retell-service');
const TwilioPhoneService = require('../services/twilio-phone-service');
const { v4: uuidv4 } = require('uuid');
const { authLimiter: rateLimiter, lenientAuthLimiter } = require('../middleware/rate-limiter');
const { generateSimplePassword } = require('../utils/password-generator');
const { requireCustomerAuth } = require('../middleware/customer-auth');

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
  if (process.env.NODE_ENV === 'production' || req.headers.host?.includes('doclittle.site')) {
    options.domain = '.doclittle.site';
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
    const { name, email, phone_number, company_name, business_size, use_case, api_features, customer_type } = req.body;

    // Log received customer_type for debugging
    console.log(`📝 Signup request - customer_type from body: ${customer_type || 'undefined'}`);
    console.log(`📝 Full request body:`, JSON.stringify({ name, email, customer_type, company_name }, null, 2));

    // Validation
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and email are required'
      });
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

    // Create customer account (pending email verification)
    const customerId = `cust_${uuidv4()}`;
    const customerRecord = {
      id: customerId,
      name,
      email,
      phone_number: phone_number || null,
      company_name: company_name || null,
      business_size: business_size || null,
      use_case: use_case || null,
      api_features: api_features || [],
      customer_type: customerType,
      pricing_tier: 'starter', // Default pricing tier
      status: 'pending',
      email_verified: false
    };
    db.createCustomer(customerRecord);

    // Track incomplete signup (Step 1: Started)
    // This helps us follow up with businesses that don't complete signup
    try {
      const env = process.env.NODE_ENV || 'development';
      db.createIncompleteSignup({
        name,
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
        name,
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
        activity_description: `${name} (${email}) submitted the signup form.`
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
      await EmailService.sendVerificationCode(email, verificationCode, name);
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

    res.json({
      success: true,
      message: 'Email verified successfully',
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        email_verified: true,
        customer_type: customer.customer_type || null // Return actual customer_type from DB
      },
      // ALWAYS show integration selection after email verification
      // This ensures user confirms their choice and we have the correct customer_type
      next_step: 'select_integration'
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

    const baseDomain = process.env.BASE_DOMAIN || 'doclittle.site';
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
    db.updateCustomer(customer.id, { password_hash: passwordHash });

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
    db.updateCustomer(customer.id, { password_hash: passwordHash });

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
        ? '/business/business-dashboard.html' 
        : (customer.customer_type === 'api' ? '/docs' : '/business/business-dashboard.html')
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
    let redirect = customerType === 'saas' ? '/business/business-dashboard.html' : '/docs';

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
        defaultRedirect = '/business/business-dashboard.html';
      } else if (customerType === 'api') {
        defaultRedirect = '/docs';
      } else {
        defaultRedirect = '/business/business-dashboard.html'; // Fallback
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

    // CRITICAL: Create merchant record for customer (if doesn't exist)
    let merchantId = customer.merchant_id;
    if (!merchantId) {
      try {
        // Generate unique merchant ID and API key
        merchantId = uuidv4();
        const apiKey = `mk_${crypto.randomBytes(32).toString('hex')}`;

        // Determine enabled platforms based on customer type
        // SaaS customers use voice platform, API customers use ACP/AP2
        const enabledPlatforms = customerType === 'saas'
          ? ['voice']
          : ['acp', 'ap2', 'voice'];

        // Create merchant record
        const merchant = {
          id: merchantId,
          name: customer.company_name || customer.name || 'Merchant',
          api_key: apiKey,
          api_url: '', // Customer can configure later
          webhook_url: '', // Customer can configure later
          enabled_platforms: enabledPlatforms,
          status: 'active'
        };

        db.createMerchant(merchant);
        console.log(`✅ Created merchant ${merchantId} for customer ${customer.id}`);

        // Link customer to merchant
        db.updateCustomer(customer.id, { merchant_id: merchantId });
        console.log(`✅ Linked customer ${customer.id} to merchant ${merchantId}`);

      } catch (merchantError) {
        console.error('❌ Failed to create merchant:', merchantError);
        // Continue - merchant can be created later, but this is critical
        // In production, we might want to fail here
        const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
        if (isProduction) {
          console.error('❌ CRITICAL: Merchant creation failed in production');
          // Don't exit, but log the error
        }
      }
    } else {
      console.log(`✅ Customer ${customer.id} already has merchant ${merchantId}`);
    }

    // Allocate free credits based on customer type
    try {
      if (customerType === 'saas') {
        // SaaS customers get 250 free minutes per month
        db.allocateFreeCredits(customer.id, 250);
        console.log(`✅ Allocated 250 free minutes (SaaS) to customer ${customer.id}`);
      } else {
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

    // Only create agent if customer doesn't already have one
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

    if (customerType === 'saas' && !customer.twilio_phone_number) {
      try {
        const twilioPhoneService = new TwilioPhoneService();

        if (twilioPhoneService.isAvailable()) {
          // Build webhook URL with customer_id parameter
          const apiBaseUrl = process.env.API_BASE_URL || process.env.BASE_URL ||
            (process.env.NODE_ENV === 'production' ? 'https://api.doclittle.site' : 'http://localhost:4000');
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
    const creditsAllocated = customerType === 'saas' ? 250 : 100;

    // CRITICAL: After payment, redirect to signup complete page
    // User will receive login details via email
    if (hasPaymentMethod) {
      redirectUrl = '/signup-complete';
      console.log(`✅ Payment verified - redirecting to signup complete page`);
    } else {
      // Payment verification required - redirect to card verification
      // After payment, they'll be redirected to login
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

    res.json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone_number: customer.phone_number,
        company_name: customer.company_name,
        business_size: customer.business_size,
        api_features: apiFeatures,
        plan_tier: customer.plan_tier,
        status: customer.status,
        email_verified: customer.email_verified === 1,
        retell_agent_id: customer.retell_agent_id,
        retell_agent_status: customer.retell_agent_status,
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

