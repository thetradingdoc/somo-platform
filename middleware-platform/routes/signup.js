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
const { v4: uuidv4 } = require('uuid');
const rateLimiter = require('../middleware/rate-limiter').authLimiter;

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

// Note: Root GET / is handled in server.js with domain-based routing
// This router only handles API endpoints (POST /api/signup, etc.)

/**
 * POST /api/signup
 * Create new customer account and send verification code
 */
router.post('/signup', rateLimiter, async (req, res) => {
  try {
    const { name, email, phone_number, company_name, business_size, use_case, api_features } = req.body;

    // Validation
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and email are required'
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
      return res.status(409).json({
        success: false,
        error: 'Email already registered',
        message: 'This email is already associated with an account'
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

    // Create customer account (pending email verification)
    const customerId = `cust_${uuidv4()}`;
    db.createCustomer({
      id: customerId,
      name,
      email,
      phone_number: phone_number || null,
      company_name: company_name || null,
      business_size: business_size || null,
      use_case: use_case || null,
      api_features: api_features || [],
      status: 'pending',
      email_verified: false
    });

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

    // Create session
    const sessionId = db.createCustomerSession(
      customer.id,
      req.ip,
      req.get('user-agent')
    );

    // Set session cookie
    res.cookie('customer_session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.json({
      success: true,
      message: 'Email verified successfully',
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        email_verified: true
      },
      next_step: 'accept_terms' // Client should redirect to /terms
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
    res.cookie('customer_session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    // Check what the next step should be
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    let nextStep = 'docs';
    let redirect = '/docs';

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

    // Check rate limit (max 3 codes per hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentCodes = db.db.prepare(`
      SELECT COUNT(*) as count FROM email_verification_codes 
      WHERE email = ? AND created_at > ?
    `).get(email, oneHourAgo);

    if (recentCodes && recentCodes.count >= 3) {
      return res.status(429).json({
        success: false,
        error: 'Too many verification requests',
        message: 'Please wait before requesting another code'
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
      // Already accepted - redirect to docs
      const redirectUrl = req.query.redirect || '/docs';
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

    // Allocate 100 free minutes when customer accepts terms
    try {
      db.allocateFreeCredits(customer.id, 100);
      console.log(`✅ Allocated 100 free minutes to customer ${customer.id}`);
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

    // REQUIRED: Check if payment method is verified (MANDATORY for all accounts)
    const hasPaymentMethod = customer.stripe_payment_method_id && customer.card_verified === 1;
    
    // Payment verification is MANDATORY - always redirect to card verification if not verified
    // This ensures every account goes through $1 payment verification before accessing docs
    const redirectUrl = hasPaymentMethod ? (req.query.redirect || '/docs') : '/verify-card';
    
    res.json({
      success: true,
      message: hasPaymentMethod ? 'Terms accepted successfully' : 'Terms accepted. Payment verification required to access API docs.',
      redirect: redirectUrl,
      credits_allocated: 100,
      retell_agent_id: retellAgentId,
      retell_agent_status: retellAgentStatus,
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
 * Verify card with $1 authorization hold
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

    const { payment_method_id } = req.body;
    if (!payment_method_id) {
      return res.status(400).json({
        success: false,
        error: 'Payment method ID is required'
      });
    }

    // Retrieve payment method to get card details
    const paymentMethod = await stripe.paymentMethods.retrieve(payment_method_id);
    if (!paymentMethod || paymentMethod.type !== 'card') {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment method'
      });
    }

    // Create $1 authorization hold (Payment Intent with capture_method: 'manual')
    // Using Payment Intent to verify card, then cancel immediately
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 100, // $1.00 in cents
      currency: 'usd',
      payment_method: payment_method_id,
      capture_method: 'manual', // Authorization only, not captured
      confirm: true,
      description: 'Card verification - DocLittle API',
      payment_method_types: ['card'], // Explicitly use card only, no redirects
      metadata: {
        customer_id: customer.id,
        type: 'card_verification'
      }
    });

    if (paymentIntent.status === 'requires_action' || paymentIntent.status === 'requires_payment_method') {
      // Card requires additional authentication (3D Secure)
      return res.json({
        success: false,
        requires_action: true,
        client_secret: paymentIntent.client_secret,
        error: 'Card requires additional authentication'
      });
    }

    if (paymentIntent.status === 'requires_capture' || paymentIntent.status === 'succeeded') {
      // Authorization successful - immediately cancel/void the authorization
      try {
        // Cancel the payment intent (voids the authorization without charging)
        await stripe.paymentIntents.cancel(paymentIntent.id);
        
        // Store payment method in database
        db.updateCustomerPaymentMethod(
          customer.id,
          payment_method_id,
          paymentMethod.card.last4,
          paymentMethod.card.brand,
          true
        );

        console.log(`✅ Card verified for customer ${customer.id}: ${paymentMethod.card.brand} ****${paymentMethod.card.last4}`);

        res.json({
          success: true,
          message: 'Card verified successfully',
          payment_method: {
            card_brand: paymentMethod.card.brand,
            card_last4: paymentMethod.card.last4
          }
        });
      } catch (cancelError) {
        console.error('❌ Failed to cancel authorization:', cancelError);
        // If cancel fails, try to refund instead
        try {
          if (paymentIntent.status === 'succeeded') {
            await stripe.refunds.create({ payment_intent: paymentIntent.id });
          }
          // Store payment method anyway (verification was successful)
          db.updateCustomerPaymentMethod(
            customer.id,
            payment_method_id,
            paymentMethod.card.last4,
            paymentMethod.card.brand,
            true
          );
          res.json({
            success: true,
            message: 'Card verified successfully',
            payment_method: {
              card_brand: paymentMethod.card.brand,
              card_last4: paymentMethod.card.last4
            }
          });
        } catch (refundError) {
          console.error('❌ Failed to refund:', refundError);
          // Payment method is stored, verification succeeded
          // Note: Customer may see a $1 hold temporarily
          db.updateCustomerPaymentMethod(
            customer.id,
            payment_method_id,
            paymentMethod.card.last4,
            paymentMethod.card.brand,
            true
          );
          res.json({
            success: true,
            message: 'Card verified successfully (authorization will be released within a few days)',
            payment_method: {
              card_brand: paymentMethod.card.brand,
              card_last4: paymentMethod.card.last4
            },
            warning: 'A temporary $1 authorization hold may appear on your card statement'
          });
        }
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Card verification failed',
        message: `Payment status: ${paymentIntent.status}`
      });
    }
  } catch (error) {
    console.error('❌ Card verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify card',
      message: error.message || 'An error occurred during card verification'
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

module.exports = router;

