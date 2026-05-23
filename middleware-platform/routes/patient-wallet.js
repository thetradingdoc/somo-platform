'use strict';

function registerPatientWalletRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    requirePatientSession,
    resolvePatientIdFromSession,
    recordPatientPortalEvent,
    PatientPortalService,
    blockWalletWhenDisabled,
    blockChatWhenDisabled,
    withIdempotency,
    botGuard,
    authLimiter,
    otpSendLimiter,
    otpConfirmLimiter,
    requireAdminAuth,
    sendUploadLinkHandler,
    issuePatientDocumentDownloadUrl,
    parseBillingDocumentUpload,
    billingOk,
    billingErr,
    resolveBillingSubscription,
    requirePlusForBillingFeature,
    isPatientWalletEnabled,
    isPatientChatEnabled,
    parseBooleanFlag,
  } = deps;

app.patch('/api/patient/:patientId/hsa-wallet', async (req, res) => {
  try {
    const { patientId } = req.params;
    const { walletAddress } = req.body;
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ success: false, error: 'Valid walletAddress (0x...) required' });
    }
    const patient = db.getFHIRPatient(patientId);
    if (!patient) return res.status(404).json({ success: false, error: 'Patient not found' });
    if (db.updateFHIRPatientWallet) db.updateFHIRPatientWallet(patientId, walletAddress);
    const updated = db.getFHIRPatient(patientId);
    res.json({ success: true, patient_wallet_address: updated?.patient_wallet_address });
  } catch (err) {
    console.error('HSA wallet link error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/patient/hsa-wallet/config', (req, res) => {
  const HSAWalletService = require('./services/hsa-wallet-service');
  res.json(HSAWalletService.getClientConfig());
});

app.post('/api/patient/wallet/deposit', apiLimiter, requirePatientSession, blockWalletWhenDisabled, async (req, res) => {
  try {
    const { patientId: sessionPatientId } = resolvePatientIdFromSession(req.patientSession || {});
    const { amount, method } = req.body || {};
    const patientId = sessionPatientId;

    if (!patientId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Authenticated patient and amount (positive number) are required'
      });
    }

    // Get or create patient wallet
    // First, check if patientId is a FHIR Patient resource_id
    // If so, use it directly; otherwise, try to find FHIR patient by phone/email
    let fhirPatientId = patientId;
    let account = db.getCircleAccountByEntity('patient', patientId);

    // If wallet doesn't exist, try to find FHIR patient and create wallet using resource_id
    if (!account) {
      // Check if this is already a FHIR Patient resource_id
      const fhirPatient = db.getFHIRPatient(patientId);

      if (fhirPatient) {
        // Use FHIR Patient resource_id directly
        fhirPatientId = fhirPatient.resource_id;
        console.log(`📋 Using FHIR Patient resource_id: ${fhirPatientId}`);
      } else {
        // Try to find FHIR patient by phone or email if provided
        const { phone, email } = req.body;
        if (phone || email) {
          let patient = null;
          if (phone) {
            patient = db.getFHIRPatientByPhone(phone);
          }
          if (!patient && email) {
            patient = db.getFHIRPatientByEmail(email);
          }

          if (patient) {
            fhirPatientId = patient.resource_id;
            console.log(`📋 Found FHIR Patient by contact info: ${fhirPatientId}`);
          }
        }
      }

      // Get or create wallet using FHIR Patient resource_id
      if (!CircleService || !CircleService.isAvailable()) {
        return res.status(503).json({
          success: false,
          error: 'Circle service is not configured. Please set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in environment variables.'
        });
      }

      // Get merchant_id from tenant context if available
      const merchantId = req.tenant?.merchant?.id ||
        req.tenant?.clinic?.merchant_id ||
        null;

      const walletResult = await CircleService.getOrCreatePatientWallet(fhirPatientId, {
        createIfNotExists: true,
        merchantId: merchantId
      });

      if (!walletResult.success) {
        return res.status(500).json({
          success: false,
          error: walletResult.error || 'Failed to create wallet'
        });
      }

      account = walletResult.account;

      // Update patientId to use FHIR resource_id for consistency
      if (fhirPatientId !== patientId) {
        console.log(`🔄 Wallet used FHIR Patient resource_id ${fhirPatientId} for ${patientId}`);
      }
    }

    if (!account || !account.circle_wallet_id) {
      return res.status(500).json({
        success: false,
        error: 'Wallet not found or not initialized'
      });
    }

    // Handle different payment methods
    const { v4: uuidv4 } = require('uuid');
    const depositId = `deposit_${uuidv4()}`;

    if (method === 'test') {
      // For test/sandbox: Use Circle SDK to transfer test USDC from system wallet
      try {
        if (!CircleService || !CircleService.isAvailable()) {
          // Fallback: Create pending record if Circle not configured
          console.warn('⚠️  Circle service not available - creating pending deposit record');
          db.db.prepare(`
            INSERT INTO circle_transfers (
              id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
              circle_transfer_id, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            depositId,
            null,
            'system',
            account.circle_wallet_id,
            amount,
            'USDC',
            `deposit_${Date.now()}`,
            'pending',
            new Date().toISOString()
          );

          return res.json({
            success: true,
            depositId: depositId,
            amount: amount,
            walletId: account.circle_wallet_id,
            method: 'test',
            status: 'pending',
            message: `Deposit record created. Circle service is not configured - please set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET.`,
            note: 'To enable real test USDC transfers, configure Circle API keys in environment variables.'
          });
        }

        // Attempt to fund wallet via Circle API
        const fundResult = await CircleService.fundWallet(account.circle_wallet_id, amount);

        if (fundResult.success) {
          // Record successful transfer
          db.db.prepare(`
            INSERT INTO circle_transfers (
              id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
              circle_transfer_id, status, created_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            depositId,
            null,
            process.env.CIRCLE_SYSTEM_WALLET_ID || 'system',
            account.circle_wallet_id,
            amount,
            'USDC',
            fundResult.transferId || `deposit_${Date.now()}`,
            'completed',
            new Date().toISOString(),
            new Date().toISOString()
          );

          console.log(`✅ Test deposit of $${amount} transferred to patient ${patientId} wallet via Circle`);

          res.json({
            success: true,
            depositId: depositId,
            amount: amount,
            walletId: account.circle_wallet_id,
            transferId: fundResult.transferId,
            method: 'test',
            message: `Successfully deposited $${amount.toFixed(2)} USDC to wallet (test mode)`
          });
        } else {
          // Fallback: Create pending record if Circle transfer fails
          // This allows the UI to work even if system wallet isn't set up
          console.warn(`⚠️  Circle funding failed: ${fundResult.error}. Creating pending record.`);

          db.db.prepare(`
            INSERT INTO circle_transfers (
              id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
              circle_transfer_id, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            depositId,
            null,
            'system',
            account.circle_wallet_id,
            amount,
            'USDC',
            `deposit_${Date.now()}`,
            'pending',
            new Date().toISOString()
          );

          res.json({
            success: true,
            depositId: depositId,
            amount: amount,
            walletId: account.circle_wallet_id,
            method: 'test',
            status: 'pending',
            message: `Deposit record created. ${fundResult.error || 'Please set up CIRCLE_SYSTEM_WALLET_ID to enable real transfers.'}`,
            note: 'To enable real test USDC transfers, create a system wallet in Circle Console, fund it with test USDC, and set CIRCLE_SYSTEM_WALLET_ID in .env'
          });
        }
      } catch (error) {
        console.error('Error funding wallet via Circle:', error);

        // Fallback: Create pending record
        db.db.prepare(`
          INSERT INTO circle_transfers (
            id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
            circle_transfer_id, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          depositId,
          null,
          'system',
          account.circle_wallet_id,
          amount,
          'USDC',
          `deposit_${Date.now()}`,
          'pending',
          new Date().toISOString()
        );

        res.json({
          success: true,
          depositId: depositId,
          amount: amount,
          walletId: account.circle_wallet_id,
          method: 'test',
          status: 'pending',
          message: `Deposit record created. Error: ${error.message}`,
          note: 'To enable real transfers, set up CIRCLE_SYSTEM_WALLET_ID with a funded system wallet'
        });
      }
    } else if (method === 'ach') {
      // ACH Bank Transfer - Circle API supports this
      // In production, this would:
      // 1. Create a deposit via Circle's ACH API
      // 2. Link user's bank account (if not already linked)
      // 3. Initiate ACH transfer
      // 4. Update status based on Circle webhook callbacks

      // For now, create pending deposit record
      db.db.prepare(`
        INSERT INTO circle_transfers (
          id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
          circle_transfer_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        depositId,
        null,
        'ach_bank', // ACH bank source
        account.circle_wallet_id,
        amount,
        'USDC',
        `ach_deposit_${Date.now()}`,
        'pending', // ACH transfers take 1-3 business days
        new Date().toISOString()
      );

      console.log(`✅ ACH deposit initiated for $${amount} to patient ${patientId} wallet`);

      res.json({
        success: true,
        depositId: depositId,
        amount: amount,
        walletId: account.circle_wallet_id,
        method: 'ach',
        status: 'pending',
        message: `ACH transfer initiated for $${amount.toFixed(2)}. Funds will be available in 1-3 business days.`,
        note: 'In production, this would integrate with Circle ACH API to initiate the bank transfer.'
      });
    } else if (method === 'wire') {
      // Wire Transfer - for large amounts, same-day
      db.db.prepare(`
        INSERT INTO circle_transfers (
          id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
          circle_transfer_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        depositId,
        null,
        'wire_bank',
        account.circle_wallet_id,
        amount,
        'USDC',
        `wire_deposit_${Date.now()}`,
        'pending',
        new Date().toISOString()
      );

      console.log(`✅ Wire transfer initiated for $${amount} to patient ${patientId} wallet`);

      res.json({
        success: true,
        depositId: depositId,
        amount: amount,
        walletId: account.circle_wallet_id,
        method: 'wire',
        status: 'pending',
        message: `Wire transfer initiated for $${amount.toFixed(2)}. Funds will be available same day.`,
        note: 'In production, this would integrate with Circle Wire Transfer API.'
      });
    } else if (method === 'stripe') {
      // Stripe Payment - Credit/Debit Card
      // Creates a Stripe Payment Intent and converts USD to USDC for wallet deposit
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        if (!stripe) {
          return res.status(500).json({
            success: false,
            error: 'Stripe not configured. Please set STRIPE_SECRET_KEY in environment variables.'
          });
        }

        // Get payment method ID from request (required for Stripe)
        const { payment_method_id, customer_email, customer_name } = req.body;

        if (!payment_method_id) {
          // If no payment method ID, create a Payment Intent that requires client-side confirmation
          if (!stripe) {
            return res.status(503).json({
              success: false,
              error: 'Payment processing is not configured. Please contact support.'
            });
          }

          const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to cents
            currency: 'usd',
            metadata: {
              patient_id: patientId,
              wallet_id: account.circle_wallet_id,
              deposit_id: depositId,
              type: 'wallet_deposit'
            },
            description: `Wallet deposit for patient ${patientId}`,
            receipt_email: customer_email || undefined
          });

          // Create pending deposit record
          db.db.prepare(`
            INSERT INTO circle_transfers (
              id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
              circle_transfer_id, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            depositId,
            null,
            'stripe',
            account.circle_wallet_id,
            amount,
            'USDC',
            paymentIntent.id,
            'pending',
            new Date().toISOString()
          );

          console.log(`💳 Stripe Payment Intent created for $${amount} wallet deposit: ${paymentIntent.id}`);

          res.json({
            success: true,
            depositId: depositId,
            amount: amount,
            walletId: account.circle_wallet_id,
            method: 'stripe',
            status: 'pending',
            payment_intent_id: paymentIntent.id,
            client_secret: paymentIntent.client_secret,
            requires_action: paymentIntent.status === 'requires_action',
            message: `Stripe payment initiated for $${amount.toFixed(2)}. Complete payment to fund wallet.`,
            note: 'Payment will be converted to USDC and deposited to your wallet after successful payment.'
          });
        } else {
          // Payment method provided - create and confirm payment intent
          if (!stripe) {
            return res.status(503).json({
              success: false,
              error: 'Payment processing is not configured. Please contact support.'
            });
          }

          const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to cents
            currency: 'usd',
            payment_method: payment_method_id,
            confirm: true,
            metadata: {
              patient_id: patientId,
              wallet_id: account.circle_wallet_id,
              deposit_id: depositId,
              type: 'wallet_deposit'
            },
            description: `Wallet deposit for patient ${patientId}`,
            receipt_email: customer_email || undefined
          });

          if (paymentIntent.status === 'succeeded') {
            // Payment successful - create pending transfer record
            // The actual wallet funding will happen via Stripe webhook for reliability
            // This ensures payment is confirmed before funding wallet

            db.db.prepare(`
              INSERT INTO circle_transfers (
                id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
                circle_transfer_id, status, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              depositId,
              null,
              'stripe',
              account.circle_wallet_id,
              amount,
              'USDC',
              paymentIntent.id,
              'pending', // Will be updated by webhook when Circle transfer completes
              new Date().toISOString()
            );

            console.log(`✅ Stripe payment successful: ${paymentIntent.id}`);
            console.log(`💰 Wallet deposit record created. Funding will be processed via webhook.`);

            // Attempt to fund wallet immediately (webhook will also handle this as backup)
            try {
              if (CircleService && CircleService.isAvailable()) {
                const fundResult = await CircleService.fundWallet(account.circle_wallet_id, amount);

                if (fundResult.success) {
                  // Update transfer status to completed
                  db.db.prepare(`
                    UPDATE circle_transfers 
                    SET status = ?, completed_at = ?, circle_transfer_id = ?
                    WHERE id = ?
                  `).run(
                    'completed',
                    new Date().toISOString(),
                    fundResult.transferId || paymentIntent.id,
                    depositId
                  );

                  console.log(`✅ Wallet funded immediately: ${fundResult.transferId}`);
                }
              }
            } catch (fundError) {
              console.warn(`⚠️  Immediate wallet funding failed, webhook will handle: ${fundError.message}`);
            }

            res.json({
              success: true,
              depositId: depositId,
              amount: amount,
              walletId: account.circle_wallet_id,
              method: 'stripe',
              status: 'completed',
              payment_intent_id: paymentIntent.id,
              stripe_payment_id: paymentIntent.id,
              message: `Successfully processed Stripe payment. Wallet deposit will be completed shortly.`,
              note: 'Payment received. USDC will be deposited to your wallet.'
            });
          } else if (paymentIntent.status === 'requires_action') {
            // Payment requires 3D Secure or other authentication
            db.db.prepare(`
              INSERT INTO circle_transfers (
                id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
                circle_transfer_id, status, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              depositId,
              null,
              'stripe',
              account.circle_wallet_id,
              amount,
              'USDC',
              paymentIntent.id,
              'pending',
              new Date().toISOString()
            );

            res.json({
              success: true,
              depositId: depositId,
              amount: amount,
              walletId: account.circle_wallet_id,
              method: 'stripe',
              status: 'requires_action',
              payment_intent_id: paymentIntent.id,
              client_secret: paymentIntent.client_secret,
              requires_action: true,
              message: 'Payment requires authentication. Please complete 3D Secure verification.',
              note: 'After payment is confirmed, funds will be converted to USDC and deposited to wallet.'
            });
          } else {
            // Payment failed or requires payment method
            res.status(400).json({
              success: false,
              error: `Payment failed: ${paymentIntent.status}`,
              payment_intent_id: paymentIntent.id,
              status: paymentIntent.status
            });
          }
        }
      } catch (error) {
        console.error('❌ Stripe payment error:', error);

        // Create failed deposit record
        db.db.prepare(`
          INSERT INTO circle_transfers (
            id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
            circle_transfer_id, status, error_message, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          depositId,
          null,
          'stripe',
          account.circle_wallet_id,
          amount,
          'USDC',
          `failed_${Date.now()}`,
          'failed',
          error.message,
          new Date().toISOString()
        );

        res.status(500).json({
          success: false,
          error: error.message || 'Stripe payment failed',
          depositId: depositId,
          method: 'stripe'
        });
      }
    } else {
      // Unknown payment method
      res.json({
        success: false,
        error: `Unknown payment method: ${method}. Supported methods: test, ach, wire, stripe`
      });
    }
  } catch (error) {
    console.error('❌ Error depositing to patient wallet:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/patient/wallet/transactions', apiLimiter, requirePatientSession, blockWalletWhenDisabled, async (req, res) => {
  try {
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const { filter = 'all' } = req.query;

    if (!patientId) {
      return res.status(400).json({
        success: false,
        error: 'Authenticated patient is required'
      });
    }

    // Get patient wallet
    const account = db.getCircleAccountByEntity('patient', patientId);
    if (!account || !account.circle_wallet_id) {
      return res.json({
        success: true,
        transactions: []
      });
    }

    // Get transfers involving this wallet
    const transfers = db.db.prepare(`
      SELECT * FROM circle_transfers
      WHERE from_wallet_id = ? OR to_wallet_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(account.circle_wallet_id, account.circle_wallet_id);

    // Get claims paid by this patient
    const claims = db.getClaimsByPatient(patientId) || [];

    // Combine and format transactions
    const transactions = [];

    // Add transfers
    transfers.forEach(transfer => {
      const isDeposit = transfer.to_wallet_id === account.circle_wallet_id && transfer.from_wallet_id === 'system';
      const isPayment = transfer.from_wallet_id === account.circle_wallet_id;

      if (filter === 'all' || (filter === 'deposit' && isDeposit) || (filter === 'medical' && isPayment)) {
        transactions.push({
          id: transfer.id,
          type: isDeposit ? 'deposit' : 'payment',
          description: isDeposit ? 'Deposit' : 'Payment',
          amount: isDeposit ? transfer.amount : -transfer.amount,
          created_at: transfer.created_at,
          status: transfer.status
        });
      }
    });

    // Add claim payments (synchronously process)
    // Include ALL claims (submitted, approved, paid) so patient can see their bills
    for (const claim of claims) {
      // Show claims that are submitted, approved, paid, or locked
      // Include ALL statuses so patient can see their bills
      // Show ALL claims so patient can see their bills - including locked/submitted
      const shouldInclude = true;

      if (shouldInclude) {
        // Calculate patient responsibility from EOB
        let patientOwe = claim.total_amount;

        // Try to get EOB data (synchronously)
        try {
          const EOBCalculationService = require('./services/eob-calculation-service');
          const eligibility = db.getEligibilityChecksByPatient(patientId)?.[0] || {};
          let claimDetails = {};
          if (claim.response_data) {
            try {
              claimDetails = typeof claim.response_data === 'string'
                ? JSON.parse(claim.response_data)
                : claim.response_data;
            } catch (e) {
              // Ignore parse errors
            }
          }

          const eob = EOBCalculationService.calculateEOBFromClaim(claim, eligibility, claimDetails);
          if (eob.totals) {
            patientOwe = eob.totals.whatYouOwe || patientOwe;
          }
        } catch (e) {
          // Use claim total if EOB calculation fails
          console.warn('Could not calculate EOB for transaction:', e.message);
        }

        // Determine transaction description based on status
        let description = `Medical Service`;
        if (claim.service_code) {
          const serviceCodes = claim.service_code.split(',').slice(0, 2).join(', ');
          description = `Medical Service (${serviceCodes})`;
        }

        // Add status to description
        const statusText = claim.status === 'submitted' ? ' - Submitted' :
          claim.status === 'approved' || claim.payment_status === 'paid' ? ' - Approved' :
            claim.status === 'paid' ? ' - Paid' : '';
        description += statusText;

        if (filter === 'all' || filter === 'medical') {
          transactions.push({
            id: claim.id,
            type: 'medical',
            description: description,
            amount: -patientOwe,
            created_at: claim.paid_at || claim.approved_at || claim.submitted_at || claim.created_at,
            status: claim.payment_status || claim.status,
            claimId: claim.id,
            claimStatus: claim.status,
            paymentStatus: claim.payment_status
          });
        }
      }
    }

    // Sort by date (newest first)
    transactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({
      success: true,
      transactions: transactions
    });
  } catch (error) {
    console.error('❌ Error getting patient wallet transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/patient/wallet/pay-claim', apiLimiter, requirePatientSession, blockWalletWhenDisabled, async (req, res) => {
  try {
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const { claimId } = req.body || {};

    if (!claimId || !patientId) {
      return res.status(400).json({
        success: false,
        error: 'claimId and authenticated patient are required'
      });
    }

    // Get claim
    const claim = db.getClaimById(claimId);
    if (!claim) {
      return res.status(404).json({
        success: false,
        error: 'Claim not found'
      });
    }
    if (claim.patient_id && String(claim.patient_id) !== String(patientId)) {
      return res.status(403).json({
        success: false,
        error: 'Not allowed to pay this claim'
      });
    }

    // Calculate patient responsibility from EOB
    let patientOwe = claim.total_amount;
    try {
      const EOBCalculationService = require('./services/eob-calculation-service');
      const eligibility = db.getEligibilityChecksByPatient(patientId)?.[0] || {};
      let claimDetails = {};
      if (claim.response_data) {
        try {
          claimDetails = typeof claim.response_data === 'string'
            ? JSON.parse(claim.response_data)
            : claim.response_data;
        } catch (e) {
          // Ignore parse errors
        }
      }

      const eob = EOBCalculationService.calculateEOBFromClaim(claim, eligibility, claimDetails);
      if (eob.totals) {
        patientOwe = eob.totals.whatYouOwe || patientOwe;
      }
    } catch (e) {
      console.warn('Could not calculate EOB, using claim total:', e.message);
    }

    // Get patient wallet
    const account = db.getCircleAccountByEntity('patient', patientId);
    if (!account || !account.circle_wallet_id) {
      return res.status(404).json({
        success: false,
        error: 'Patient wallet not found. Please create a wallet first.'
      });
    }

    // Check wallet balance
    const balanceResult = await CircleService.getWalletBalance(account.circle_wallet_id);
    let currentBalance = 0;

    if (balanceResult.success && balanceResult.balances && balanceResult.balances.length > 0) {
      const usdcBalance = balanceResult.balances.find(b => b.token?.symbol === 'USDC') || balanceResult.balances[0];
      currentBalance = parseFloat(usdcBalance.amount || usdcBalance.balance || 0);
    }

    if (currentBalance < patientOwe) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance. You have $${currentBalance.toFixed(2)}, but need $${patientOwe.toFixed(2)}`,
        currentBalance: currentBalance,
        required: patientOwe
      });
    }

    // Get provider wallet
    const providerAccount = db.getCircleAccountByEntity('provider', 'default');
    if (!providerAccount || !providerAccount.circle_wallet_id) {
      return res.status(500).json({
        success: false,
        error: 'Provider wallet not found'
      });
    }

    // Create transfer from patient to provider
    const transferResult = await CircleService.createTransfer({
      fromWalletId: account.circle_wallet_id,
      toWalletId: providerAccount.circle_wallet_id,
      amount: patientOwe,
      currency: 'USDC',
      claimId: claimId,
      description: `Payment for claim ${claimId}`
    });

    if (!transferResult.success) {
      return res.status(500).json({
        success: false,
        error: transferResult.error || 'Failed to process payment'
      });
    }

    // Record transfer
    const { v4: uuidv4 } = require('uuid');
    const transferId = `transfer_${uuidv4()}`;

    db.createCircleTransfer({
      id: transferId,
      claim_id: claimId,
      from_wallet_id: account.circle_wallet_id,
      to_wallet_id: providerAccount.circle_wallet_id,
      amount: patientOwe,
      currency: 'USDC',
      circle_transfer_id: transferResult.transferId,
      status: transferResult.status || 'pending'
    });

    // Update claim payment status
    db.updateInsuranceClaim(claimId, {
      payment_status: 'paid',
      payment_amount: patientOwe,
      paid_at: new Date().toISOString()
    });

    console.log(`✅ Patient ${patientId} paid $${patientOwe.toFixed(2)} for claim ${claimId}`);

    res.json({
      success: true,
      claimId: claimId,
      amount: patientOwe,
      transferId: transferResult.transferId,
      message: 'Payment processed successfully'
    });
  } catch (error) {
    console.error('❌ Error processing patient payment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/patient/:patientId/cards', async (req, res) => {
  try {
    const { patientId } = req.params;

    // Get cards (JSON fields are already parsed by database function)
    const cards = db.getCardsByPatientId(patientId);

    res.json({
      success: true,
      cards: cards,
      count: cards.length
    });
  } catch (error) {
    console.error('❌ Error fetching patient cards:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch cards'
    });
  }
});

app.post('/api/patient/:patientId/cards', async (req, res) => {
  try {
    const { patientId } = req.params;
    const { spending_limit, spending_interval, clinic_id } = req.body;

    // Get patient
    const patient = db.getFHIRPatient(patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: 'Patient not found'
      });
    }

    // Create card using FHIR service
    const result = await FHIRService.createPatientCard(patient.resource_data, {
      clinic_id: clinic_id || null,
      spending_limit: spending_limit || 100000, // $1,000 default
      spending_interval: spending_interval || 'all_time'
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to create card'
      });
    }

    res.json({
      success: true,
      card: {
        card_id: result.card_id,
        cardholder_id: result.cardholder_id,
        last4: result.last4,
        brand: result.brand
      }
    });
  } catch (error) {
    console.error('❌ Error creating patient card:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create card'
    });
  }
});

app.get('/api/patient/cards/:cardId', requireAdminAuth, async (req, res) => {
  try {
    const { cardId } = req.params;

    // Get card from database
    const card = db.getCardById(cardId);
    if (!card) {
      return res.status(404).json({
        success: false,
        error: 'Card not found'
      });
    }

    // Get card details from Stripe (if Stripe Issuing is enabled)
    let cardDetails = null;
    if (StripeIssuingService && card.stripe_card_id) {
      const stripeIssuing = new StripeIssuingService();
      const detailsResult = await stripeIssuing.getCardDetails(card.stripe_card_id);
      if (detailsResult.success) {
        cardDetails = {
          pan: detailsResult.pan, // Primary Account Number (card number)
          cvc: detailsResult.cvc, // Card Verification Code
          last4: detailsResult.last4,
          brand: detailsResult.brand,
          expiry_month: detailsResult.expiry_month,
          expiry_year: detailsResult.expiry_year
        };
      }
    }

    res.json({
      success: true,
      card: {
        ...card,
        // JSON fields are already parsed by database function
        details: cardDetails // PAN and CVC (only for virtual cards, in live mode)
      }
    });
  } catch (error) {
    console.error('❌ Error fetching card details:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch card details'
    });
  }
});

app.patch('/api/patient/cards/:cardId/spending-controls', async (req, res) => {
  try {
    const { cardId } = req.params;
    const { spending_limit, spending_interval, allowed_categories, blocked_categories } = req.body;

    // Get card from database
    const card = db.getCardById(cardId);
    if (!card) {
      return res.status(404).json({
        success: false,
        error: 'Card not found'
      });
    }

    if (!StripeIssuingService || !card.stripe_card_id) {
      return res.status(400).json({
        success: false,
        error: 'Stripe Issuing not configured'
      });
    }

    // Build spending controls
    const spendingControls = {
      spending_limits: [
        {
          amount: spending_limit || 100000,
          interval: spending_interval || 'all_time'
        }
      ]
    };

    if (allowed_categories) {
      spendingControls.allowed_categories = allowed_categories;
    }

    if (blocked_categories) {
      spendingControls.blocked_categories = blocked_categories;
    }

    // Update in Stripe
    const stripeIssuing = new StripeIssuingService();
    const result = await stripeIssuing.updateCardSpendingControls(card.stripe_card_id, spendingControls);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to update spending controls'
      });
    }

    // Update in database
    db.updateCardSpendingControls(cardId, spendingControls);

    res.json({
      success: true,
      card: {
        ...card,
        spending_controls: spendingControls
      }
    });
  } catch (error) {
    console.error('❌ Error updating card spending controls:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update spending controls'
    });
  }
});

app.post('/api/patient/cards/:cardId/cancel', async (req, res) => {
  try {
    const { cardId } = req.params;

    // Get card from database
    const card = db.getCardById(cardId);
    if (!card) {
      return res.status(404).json({
        success: false,
        error: 'Card not found'
      });
    }

    if (!StripeIssuingService || !card.stripe_card_id) {
      return res.status(400).json({
        success: false,
        error: 'Stripe Issuing not configured'
      });
    }

    // Cancel in Stripe
    const stripeIssuing = new StripeIssuingService();
    const result = await stripeIssuing.cancelCard(card.stripe_card_id);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to cancel card'
      });
    }

    // Update status in database
    db.updateCardStatus(cardId, 'canceled');

    res.json({
      success: true,
      message: 'Card canceled successfully'
    });
  } catch (error) {
    console.error('❌ Error canceling card:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cancel card'
    });
  }
});

app.get('/api/patient/cards/:cardId/transactions', async (req, res) => {
  try {
    const { cardId } = req.params;

    // Get transactions (JSON fields are already parsed by database function)
    const transactions = db.getTransactionsByCardId(cardId);

    res.json({
      success: true,
      transactions: transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('❌ Error fetching card transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch transactions'
    });
  }
});

app.get('/api/patient/:patientId/transactions', async (req, res) => {
  try {
    const { patientId } = req.params;

    // Get transactions (JSON fields are already parsed by database function)
    const transactions = db.getTransactionsByPatientId(patientId);

    res.json({
      success: true,
      transactions: transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('❌ Error fetching patient transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch transactions'
    });
  }
});
}

module.exports = { registerPatientWalletRoutes };
