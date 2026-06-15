/**
 * Customer auth routes — extracted from routes/signup.js
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
  authLimiter,
  lenientAuthLimiter,
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


router.post('/signin', authLimiter, async (req, res) => {
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
router.post('/customers/forgot-password', authLimiter, async (req, res) => {
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

    const baseDomain = process.env.BASE_DOMAIN || 'callsomo.com';
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
router.post('/customers/change-password', authLimiter, requireCustomerAuth, async (req, res) => {
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
router.post('/customers/reset-password', authLimiter, async (req, res) => {
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
router.post('/customers/login', lenientAuthLimiter, async (req, res) => {
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
router.post('/signin/verify', authLimiter, async (req, res) => {
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

    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim()
      .toLowerCase()
      .replace(/:\d+$/, '');
    const onApiHost = host === 'api.callsomo.com' || host === 'api.callsomo.com';

    let nextStep = customerType === 'saas' ? 'dashboard' : 'docs';
    let redirect = customerType === 'saas' ? SAAS_PORTAL_HOME : '/docs';
    if (customerType === 'saas' && onApiHost) {
      redirect = 'https://callsomo.com/login';
    }

    if (!termsAccepted) {
      nextStep = 'terms';
      if (customerType === 'api') {
        redirect = '/terms?customer_type=api&redirect=/docs';
      } else if (onApiHost) {
        redirect = 'https://callsomo.com/signup';
      } else {
        redirect = '/terms';
      }
    } else if (!customer.card_verified) {
      nextStep = 'verify_card';
      if (customerType === 'api') {
        redirect = '/verify-card?customer_type=api&redirect=/docs';
      } else if (onApiHost) {
        redirect = 'https://callsomo.com/login';
      } else {
        redirect = '/verify-card';
      }
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

router.post('/customers/signout', authLimiter, async (req, res) => {
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

module.exports = router;
