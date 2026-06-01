/**
 * SIGNUP ROUTES (composite)
 * Mount order preserved: trial → auth → account
 */
'use strict';

const express = require('express');
const signupTrialRouter = require('./signup-trial');
const customerAuthRouter = require('./customer-auth');
const customerAccountRouter = require('./customer-account');

const router = express.Router();
router.use(signupTrialRouter);
router.use(customerAuthRouter);
router.use(customerAccountRouter);

module.exports = router;
