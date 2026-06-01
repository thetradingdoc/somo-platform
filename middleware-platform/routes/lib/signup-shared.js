/**
 * Shared signup/auth helpers and dependencies.
 */
'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('../../database');
const EmailService = require('../../services/email-service');
const ProviderService = require('../../services/provider-service');
const RetellService = require('../../services/retell-service');
const TwilioPhoneService = require('../../services/twilio-phone-service');
const { v4: uuidv4 } = require('uuid');
const { authLimiter: rateLimiter, lenientAuthLimiter } = require('../../middleware/rate-limiter');
const { generateSimplePassword } = require('../../utils/password-generator');
const { requireCustomerAuth } = require('../../middleware/customer-auth');
const {
  ensureClaimSessionTables,
  claimLandingSessionToCustomer,
  listCustomerProducts
} = require('../../services/landing-session-claim-service');

let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch (e) {
  console.error('❌ bcryptjs not installed - password hashing will fail');
  bcrypt = null;
}

const stripeConfig = require('../../utils/stripe-config');
let stripe = null;
try {
  stripe = stripeConfig.initializeStripe();
} catch (error) {
  console.error('⚠️  Stripe initialization failed:', error.message);
}

/** Canonical provider portal home after SaaS signup (see server.js SAAS_PROVIDER_PORTAL_HOME). */
const SAAS_PORTAL_HOME = '/business/today.html';

function getSessionCookieOptions(req, maxAge = 30 * 24 * 60 * 60 * 1000) {
  const isSecure = process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
  const options = {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: maxAge
  };
  const cookieHost = (req.headers.host || '').toLowerCase();
  if (process.env.NODE_ENV === 'production') {
    if (cookieHost.includes('myskinandcare.com')) options.domain = '.myskinandcare.com';
    else if (cookieHost.includes('skinandcare.com')) options.domain = '.skinandcare.com';
    else if (cookieHost.includes('doclittle.site')) options.domain = '.doclittle.site';
  }
  return options;
}

module.exports = {
  express,
  crypto,
  db,
  EmailService,
  ProviderService,
  RetellService,
  TwilioPhoneService,
  uuidv4,
  rateLimiter,
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
};
