'use strict';

function registerVoiceAppointmentRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    scheduleCheckoutLimiter,
    voiceLimiter,
    withIdempotency,
    resolveClinicIdFromRequest,
    FALLBACK_CLINIC_ID,
    ensureSlotBundles,
  } = deps;

app.post('/voice/appointments/checkout', scheduleCheckoutLimiter, voiceLimiter, withIdempotency('voice_checkout'), async (req, res) => {
  try {
    console.log('\n💳 VOICE: Create Appointment Checkout');
    safeLogRequestBody('Request body:', req);

    // TEST_MODE: bypass outbound email delivery and return verification_code directly
    const TEST_MODE = process.env.TEST_MODE === '1' || process.env.TEST_MODE === 'true';
    const includeTestVerificationCode = TEST_MODE && process.env.NODE_ENV !== 'production';

    const args = req.body.args || req.body;
    const triageSessionIdForAudit = resolveVoiceSessionIdForGuard(args, req);
    let clinicId = resolveClinicIdFromRequest(req, args);

    // Calculate amount based on insurance coverage if available
    // Default: fixed price per appointment if no insurance info
    let amount = args.amount; // If provided, caller overrides pricing

    // Build a minimal checkout record tied to the appointment
    const checkoutId = require('uuid').v4();

    // Ensure customer_phone is provided (required field)
    const customerPhone = args.customer_phone || args.patient_phone || '0000000000';

    // Try to find appointment by ID, phone, or email (S-2: tenant-scoped)
    let appointmentId = args.appointment_id || null;
    let appointmentRecord = null;
    const customerId = args.metadata?.customer_id || args.customer_id || req.body?.metadata?.customer_id || null;
    if (appointmentId) {
      appointmentRecord = await db.getAppointment(appointmentId, clinicId || null, customerId || null);
      if (!appointmentRecord) {
        return res.status(400).json({
          success: false,
          error: 'Invalid appointment_id. Appointment not found for this clinic/tenant context.',
          error_code: 'INVALID_APPOINTMENT_ID',
          appointment_id: appointmentId
        });
      }
      if (!clinicId) {
        clinicId = appointmentRecord.clinic_id || clinicId;
      }
    }
    if (!appointmentId) {
      // Search for most recent appointment for this customer
      const BookingService = require('./services/booking-service');
      const searchTerm = customerPhone || args.customer_email || args.patient_email;
      if (searchTerm) {
        try {
          let scopedClinic = clinicId;
          if (!scopedClinic && appointmentId) {
            const appointment = await db.getAppointment(appointmentId);
            scopedClinic = appointment?.clinic_id || null;
          }
          if (!scopedClinic && !customerId) {
            throw new Error('Missing clinic or customer context for appointment lookup');
          }

          const searchResult = await BookingService.searchAppointments(searchTerm, scopedClinic || null, customerId);
          if (searchResult.success && searchResult.appointments && searchResult.appointments.length > 0) {
            // Get the most recent scheduled/confirmed appointment
            const recentAppt = searchResult.appointments
              .filter(a => ['scheduled', 'confirmed'].includes(a.status))
              .sort((a, b) => new Date(b.date + ' ' + b.time) - new Date(a.date + ' ' + a.time))[0];
            if (recentAppt) {
              appointmentId = recentAppt.id;
              appointmentRecord = await db.getAppointment(appointmentId, scopedClinic || null, customerId || null);
              console.log(`📋 Linked checkout to appointment: ${appointmentId}`);
            }
          }
        } catch (searchError) {
          console.warn('⚠️  Could not find appointment for checkout:', searchError.message);
        }
      }
    }

    // If appointment_id is available, calculate patient responsibility based on insurance
    if (appointmentId && amount == null) {
      try {
        const appointment = appointmentRecord || await db.getAppointment(appointmentId, clinicId || null, customerId || null);
        if (appointment && !clinicId) {
          clinicId = appointment.clinic_id || clinicId;
        }
        if (appointment && appointment.patient_id) {
          // Try to get latest eligibility for this patient
          const eligibility_checks = db.db.prepare(`
            SELECT * FROM eligibility_checks 
            WHERE patient_id = ? 
            ORDER BY created_at DESC LIMIT 1
          `).all(appointment.patient_id);
          const eligibilityChecks = eligibility_checks;

          if (eligibility_checks && eligibility_checks.length > 0) {
            const latestEligibility = eligibility_checks[0];
            // Calculate patient responsibility based on EOB
            if (latestEligibility.allowed_amount !== null && latestEligibility.insurance_pays !== null) {
              const patientOwe = latestEligibility.allowed_amount - latestEligibility.insurance_pays;
              amount = Math.max(0, patientOwe);
              console.log(`💰 Calculated patient responsibility: $${amount.toFixed(2)} (Insurance covers $${latestEligibility.insurance_pays.toFixed(2)} of $${latestEligibility.allowed_amount.toFixed(2)})`);
            } else if (latestEligibility.copay_amount) {
              // Fallback to copay if available
              amount = latestEligibility.copay_amount;
              console.log(`💰 Using copay amount: $${amount.toFixed(2)}`);
            }
          }
        }
      } catch (error) {
        console.warn('⚠️  Could not calculate insurance-adjusted amount:', error.message);
      }
    }

    // If still no amount, use visit_pricing (Task 17: same source as GET /api/pricing)
    if (amount == null) {
      try {
        let appointmentType = args.appointment_type || null;
        if (!appointmentType && appointmentId) {
          const appointment = appointmentRecord || await db.getAppointment(appointmentId, clinicId || null, customerId || null);
          appointmentType = appointment?.appointment_type || appointmentType;
          if (appointment && !clinicId) {
            clinicId = appointment.clinic_id || clinicId;
          }
        }
        const pricing = db.getEffectiveVisitPrice(clinicId, appointmentType || 'General Consult');
        amount = pricing.effective_price;
        console.log(`💰 Visit pricing: clinic=${clinicId} type="${pricing.canonicalType}" base=$${pricing.base_price} surge_enabled=${pricing.surge_enabled} mult=${pricing.surge_multiplier} => $${amount.toFixed(2)}`);
      } catch (e) {
        const { DEFAULT_FALLBACK } = require('./config/pricing-fallbacks');
        amount = DEFAULT_FALLBACK;
      }
    }

    // Resolve merchant_id from clinic_id or args
    let merchantId = args.merchant_id;
    if (!merchantId && clinicId) {
      const clinic = await db.getClinicById(clinicId);
      if (clinic && !clinic.merchant_id) {
        // Chk-C4: single-tenant fallback to managed merchant creation
        clinic.merchant_id = ensureMerchantForClinic(clinic);
      }
      if (clinic && clinic.merchant_id) {
        merchantId = clinic.merchant_id;
      }
    }
    if (!merchantId && appointmentId) {
      // Try to get from appointment
      const appointment = appointmentRecord || await db.getAppointment(appointmentId, clinicId || null, customerId || null);
      if (appointment && appointment.clinic_id) {
        const clinic = await db.getClinicById(appointment.clinic_id);
        if (clinic && !clinic.merchant_id) {
          clinic.merchant_id = ensureMerchantForClinic(clinic);
        }
        if (clinic && clinic.merchant_id) {
          merchantId = clinic.merchant_id;
        }
      }
    }

    // If still no merchant_id, return error instead of creating default
    if (!merchantId) {
      console.error('[CHECKOUT] merchantId not found for clinic:', clinicId);
      return res.status(500).json({
        success: false,
        error: 'MERCHANT_NOT_CONFIGURED',
        message: 'Payment is not configured for this clinic. Please contact support.'
      });
    }

    // Verify merchant exists
    const existingMerchant = db.getMerchant(merchantId);
    if (!existingMerchant) {
      console.error(`[CHECKOUT] merchantId ${merchantId} not found in database for clinic:`, clinicId);
      return res.status(500).json({
        success: false,
        error: 'MERCHANT_NOT_CONFIGURED',
        message: 'Payment is not configured for this clinic. Please contact support.'
      });
    }

    if (!clinicId && appointmentId) {
      appointmentRecord = appointmentRecord || await db.getAppointment(appointmentId, clinicId || null, customerId || null);
      clinicId = appointmentRecord?.clinic_id || clinicId;
    }

    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to create a voice checkout'
      });
    }

    // Idempotency / dedupe: if a checkout already exists for this appointment_id,
    // reuse it (prevents multi-path/concurrent "triple checkout" creation).
    if (appointmentId) {
      try {
        const pending = db.getPendingCheckoutForAppointment && db.getPendingCheckoutForAppointment(appointmentId);
        const existingCheckout = pending?.checkout || null;
        if (existingCheckout?.id && existingCheckout.deleted_at == null) {
          const tokenRow = db.db.prepare(`
            SELECT * FROM payment_tokens
            WHERE checkout_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          `).get(existingCheckout.id);

          // Populate triage linkage for audit (C9) even when an older row exists.
          if (triageSessionIdForAudit && !existingCheckout.triage_session_id) {
            try { await db.updateVoiceCheckout(existingCheckout.id, { triage_session_id: triageSessionIdForAudit }); } catch (_) {}
          }
          if (triageSessionIdForAudit && appointmentId) {
            try {
              db.db?.prepare(
                'UPDATE voice_checkouts SET triage_session_id = COALESCE(triage_session_id, ?) WHERE appointment_id = ?'
              ).run(triageSessionIdForAudit, appointmentId);
            } catch (_) {}
          }

          if (tokenRow?.token) {
            const checkoutResponse = PaymentFlowService.buildLifecycleResponse({
              stage: 'checkout_created',
              nextAction: 'verify_identity_code',
                message: includeTestVerificationCode
                  ? 'Verification code returned (checkout reused in TEST_MODE)'
                  : 'Verification code already generated (checkout reused)',
              checkoutId: existingCheckout.id,
              paymentToken: tokenRow.token,
              requiresVerification: true,
              extra: {
                amount: existingCheckout.amount,
                currency: 'USD',
                  email_sent: includeTestVerificationCode ? false : !!existingCheckout.customer_email,
                  verification_code: includeTestVerificationCode ? tokenRow.verification_code : undefined,
                  verification_code_expires: includeTestVerificationCode ? tokenRow.verification_code_expires : undefined,
                  verification_code_returned: includeTestVerificationCode ? true : undefined
              }
            });

            PaymentFlowService.logTransition('checkout_created_reused', {
              checkout_id: existingCheckout.id,
              appointment_id: appointmentId,
              clinic_id: clinicId,
              merchant_id: merchantId,
              triage_session_id: triageSessionIdForAudit || existingCheckout.triage_session_id || null
            });

            return res.json(checkoutResponse);
          }

          // Token missing (common when the first request timed out before reaching token generation):
          // reuse the existing voice_checkouts row and generate the token/code on it.
          let appointment = null;
          try {
            appointment = appointmentRecord || await db.getAppointment(appointmentId, clinicId);
          } catch (_) {}

          // Mirror the "card creation" block but target the existing checkout row.
          if (amount > 0 && appointmentId) {
            try {
              if (appointment && appointment.patient_id) {
                const FHIRService = require('./services/fhir-service');
                const eligibility_checks = db.getEligibilityChecksByPatient?.(appointment.patient_id) || [];
                const isCopay =
                  eligibility_checks.length > 0 && eligibility_checks[0].copay_amount === amount;

                if (isCopay) {
                  await FHIRService.createCardForCopay(appointment.patient_id, amount, {
                    appointment_id: appointmentId,
                    checkout_id: existingCheckout.id
                  });
                } else {
                  await FHIRService.createCardForBill(appointment.patient_id, amount, {
                    appointment_id: appointmentId,
                    checkout_id: existingCheckout.id
                  });
                }
              }
            } catch (_) {}
          }

          const crypto = require('crypto');
          const paymentToken = crypto.randomBytes(32).toString('hex');
          const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
          const codeExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

          await db.createPaymentToken({
            token: paymentToken,
            checkout_id: existingCheckout.id,
            verification_code: verificationCode,
            verification_code_expires: codeExpires,
            status: 'pending'
          });

          const emailDeliveryQueued = !TEST_MODE && !!existingCheckout.customer_email;
          if (emailDeliveryQueued) {
            setImmediate(async () => {
              try {
                const EmailService = require('./services/email-service');
                await EmailService.sendCheckoutVerificationCode(existingCheckout.customer_email, verificationCode);
                console.log('[CHECKOUT] Verification email sent to:', String(existingCheckout.customer_email || '').slice(0, 4) + '…');
              } catch (emailError) {
                console.error('⚠️  Email delivery failed (token-missing reuse path):', emailError.message);
              }
              try {
                if (appointmentId && appointment) {
                  const EmailService = require('./services/email-service');
                  const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
                  const paymentLink = `${baseUrl}/payment/${paymentToken}`;
                  await EmailService.sendPatientBillingEmail(existingCheckout.customer_email, {
                    patientName: existingCheckout.customer_name || appointment.patient_name,
                    appointmentDate: appointment.date,
                    serviceName: appointment.appointment_type || 'Therapy Session',
                    totalAmount: amount + amount * 0.1,
                    insuranceAmount: amount * 0.1,
                    copayAmount: amount,
                    amountDue: amount,
                    paymentLink
                  });
                }
              } catch (emailError) {
                console.error('⚠️  Billing email delivery failed (token-missing reuse path):', emailError.message);
              }
            });
          }

          const checkoutResponse = PaymentFlowService.buildLifecycleResponse({
            stage: 'checkout_created',
            nextAction: 'verify_identity_code',
            message: includeTestVerificationCode
              ? 'Verification code returned (TEST_MODE: email skipped)'
              : (emailDeliveryQueued ? 'Verification code generated (email queued)' : 'Verification code generated (email not sent)'),
            checkoutId: existingCheckout.id,
            paymentToken,
            requiresVerification: true,
            extra: {
              amount: existingCheckout.amount,
              currency: 'USD',
              email_sent: false,
              email_queued: emailDeliveryQueued,
              billing_email_sent: false,
              billing_email_queued: emailDeliveryQueued,
              verification_code: includeTestVerificationCode ? verificationCode : undefined,
              verification_code_expires: includeTestVerificationCode ? codeExpires : undefined,
              verification_code_returned: includeTestVerificationCode ? true : undefined
            }
          });

          PaymentFlowService.logTransition('checkout_created_reused_token_missing', {
            checkout_id: existingCheckout.id,
            appointment_id: appointmentId,
            clinic_id: clinicId,
            merchant_id: merchantId,
            triage_session_id: triageSessionIdForAudit || existingCheckout.triage_session_id || null
          });

          return res.json(checkoutResponse);
        }
      } catch (dedupeErr) {
        console.warn('⚠️ voice checkout dedupe failed:', dedupeErr.message);
      }
    }

    const checkout = {
      id: checkoutId,
      merchant_id: merchantId,
      product_id: 'APPOINTMENT',
      product_name: args.appointment_type ? `Appointment - ${args.appointment_type}` : 'Appointment',
      quantity: 1,
      amount: amount,
      customer_phone: customerPhone, // Required field - cannot be null
      customer_name: args.customer_name || args.patient_name || 'Patient',
      customer_email: args.customer_email || args.patient_email || null,
      appointment_id: appointmentId, // Link to appointment
      status: 'pending',
      clinic_id: clinicId,
      triage_session_id: triageSessionIdForAudit || null
    };

    // Store checkout
    await db.createVoiceCheckout(checkout);

    // Create Stripe card on-demand if patient has insurance and copay is due
    if (amount > 0 && appointmentId) {
      try {
        const appointment = await db.getAppointment(appointmentId, clinicId);
        if (appointment && appointment.patient_id) {
          const FHIRService = require('./services/fhir-service');
          // Guard: fetch eligibility in this scope (was undefined when amount came from pricing)
          const eligibility_checks = db.getEligibilityChecksByPatient?.(appointment.patient_id) || [];
          const eligibilityChecks = eligibility_checks;
          const isCopay = eligibility_checks.length > 0 &&
            eligibility_checks[0].copay_amount === amount;

          if (isCopay) {
            console.log(`💳 Creating payment card for appointment copay: $${amount.toFixed(2)}`);
            await FHIRService.createCardForCopay(appointment.patient_id, amount, {
              appointment_id: appointmentId,
              checkout_id: checkoutId
            });
          } else {
            // Patient responsibility (bill)
            console.log(`💳 Creating payment card for appointment payment: $${amount.toFixed(2)}`);
            await FHIRService.createCardForBill(appointment.patient_id, amount, {
              appointment_id: appointmentId,
              checkout_id: checkoutId
            });
          }
        }
      } catch (cardError) {
        // Don't fail checkout if card creation fails
        console.warn('⚠️  Failed to create payment card for appointment checkout:', cardError.message);
      }
    }

    // Generate token + code
    const crypto = require('crypto');
    const paymentToken = crypto.randomBytes(32).toString('hex');
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const codeExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.createPaymentToken({
      token: paymentToken,
      checkout_id: checkoutId,
      verification_code: verificationCode,
      verification_code_expires: codeExpires,
      status: 'pending'
    });

    // Email the code (TEST_MODE bypass + fire-and-forget to avoid checkout latency tails)
    const emailDeliveryQueued = !TEST_MODE && !!checkout.customer_email;
    if (emailDeliveryQueued) {
      setImmediate(async () => {
        try {
          const EmailService = require('./services/email-service');
          await EmailService.sendCheckoutVerificationCode(checkout.customer_email, verificationCode);
          console.log('[CHECKOUT] Verification email sent to:', String(checkout.customer_email || '').slice(0, 4) + '…');
        } catch (emailError) {
          console.error('⚠️  Email delivery failed:', emailError.message);
        }
        try {
          if (appointmentId) {
            const appointment = await db.getAppointment(appointmentId, clinicId);
            if (appointment) {
              const EmailService = require('./services/email-service');
              const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
              const paymentLink = `${baseUrl}/payment/${paymentToken}`;
              await EmailService.sendPatientBillingEmail(checkout.customer_email, {
                patientName: checkout.customer_name || appointment.patient_name,
                appointmentDate: appointment.date,
                serviceName: appointment.appointment_type || 'Therapy Session',
                totalAmount: amount + (amount * 0.1),
                insuranceAmount: amount * 0.1,
                copayAmount: amount,
                amountDue: amount,
                paymentLink: paymentLink
              });
            }
          }
        } catch (billingEmailError) {
          console.error('⚠️  Billing email delivery failed:', billingEmailError.message);
        }
      });
    }

    const checkoutResponse = PaymentFlowService.buildLifecycleResponse({
      stage: 'checkout_created',
      nextAction: 'verify_identity_code',
      message: includeTestVerificationCode
        ? 'Verification code returned (TEST_MODE: email skipped)'
        : (emailDeliveryQueued ? 'Verification code generated (email queued)' : 'Verification code generated (email not sent)'),
      checkoutId,
      paymentToken,
      requiresVerification: true,
      extra: {
        amount,
        currency: 'USD',
        email_sent: false,
        email_queued: emailDeliveryQueued,
        billing_email_sent: false,
        billing_email_queued: emailDeliveryQueued,
        verification_code: includeTestVerificationCode ? verificationCode : undefined,
        verification_code_expires: includeTestVerificationCode ? codeExpires : undefined,
        verification_code_returned: includeTestVerificationCode ? true : undefined
      }
    });
    PaymentFlowService.logTransition('checkout_created', {
      checkout_id: checkoutId,
      appointment_id: appointmentId,
      clinic_id: clinicId,
      merchant_id: merchantId,
      triage_session_id: triageSessionIdForAudit || null
    });
    return res.json(checkoutResponse);
  } catch (error) {
    console.error('❌ Error creating appointment checkout:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/voice/checkout/verify', async (req, res) => {
  try {
    console.log('\n🔐 VOICE: Verify Email Code');
    safeLogRequestBody('Request body:', req);

    // TEST_MODE: bypass outbound email and keep verification fast/deterministic.
    const TEST_MODE = process.env.TEST_MODE === '1' || process.env.TEST_MODE === 'true';

    const args = req.body.args || req.body;
    const token = args.payment_token || args.token;
    const code = args.code || args.verification_code;
    const triageSessionVerify = resolveVoiceSessionIdForGuard(args, req);

    if (!token || !code) {
      return res.status(400).json({
        success: false,
        error: 'payment_token and code are required',
        error_code: 'MISSING_VERIFY_FIELDS',
        next_step: 'Provide payment_token and the 6-digit verification_code, then retry.'
      });
    }

    if (triageSessionVerify) {
      try {
        console.log(
          JSON.stringify({
            event: 'voice_checkout_verify',
            triage_session_id: triageSessionVerify
          })
        );
      } catch (_) {}
    }

    const tokenRecord = db.getPaymentToken(token);
    if (!tokenRecord) {
      return res.status(404).json({
        success: false,
        error: 'Invalid token',
        error_code: 'INVALID_PAYMENT_TOKEN',
        next_step: 'Create a new checkout and request a fresh verification code.'
      });
    }

    // Check expiration
    if (tokenRecord.verification_code_expires) {
      const now = new Date();
      const exp = new Date(tokenRecord.verification_code_expires);
      if (now > exp) {
        return res.status(400).json({
          success: false,
          error: 'Verification code expired',
          error_code: 'VERIFICATION_CODE_EXPIRED',
          next_step: 'Re-run create_appointment_checkout to resend a new verification code.'
        });
      }
    }

    // Check code match
    if ((tokenRecord.verification_code || '').trim() !== String(code).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid verification code',
        error_code: 'INVALID_VERIFICATION_CODE',
        next_step: 'Ask the patient to re-check the 6-digit code and retry.'
      });
    }

    // Fetch checkout to email link
    const checkout = await db.getVoiceCheckout(tokenRecord.checkout_id);
    if (!checkout) {
      return res.status(404).json({ success: false, error: 'Checkout not found' });
    }

    // Check if patient has wallet with sufficient balance
    let walletInfo = null;
    try {
      // Try to find FHIR patient by email or phone
      let fhirPatient = null;
      if (checkout.customer_email) {
        fhirPatient = db.getFHIRPatientByEmail(checkout.customer_email);
      }
      if (!fhirPatient && checkout.customer_phone) {
        fhirPatient = db.getFHIRPatientByPhone(checkout.customer_phone);
      }

      if (fhirPatient && CircleService && CircleService.isAvailable()) {
        // Get patient wallet
        const walletResult = await CircleService.getOrCreatePatientWallet(fhirPatient.resource_id, {
          createIfNotExists: false // Don't create wallet if it doesn't exist
        });

        if (walletResult.success && walletResult.account) {
          // Get wallet balance
          const balanceResult = await CircleService.getWalletBalance(walletResult.account.circle_wallet_id);

          if (balanceResult.success) {
            // Extract USDC balance from balances array
            const balances = balanceResult.balances || [];
            let usdcBalance = 0;
            let usdcCurrency = 'USDC';

            // Find USDC balance (token balances are usually in format { token: { symbol: 'USDC', ... }, amount: '1000000' })
            // Amount is typically in smallest unit (e.g., 6 decimals for USDC)
            for (const balance of balances) {
              if (balance.token && (balance.token.symbol === 'USDC' || balance.token.symbol === 'USDC.e')) {
                // Convert from smallest unit (6 decimals) to dollars
                const amount = parseFloat(balance.amount || '0');
                usdcBalance = amount / 1000000; // USDC has 6 decimals
                usdcCurrency = balance.token.symbol || 'USDC';
                break;
              }
            }

            walletInfo = {
              has_wallet: true,
              wallet_id: walletResult.account.circle_wallet_id,
              balance: usdcBalance,
              currency: usdcCurrency,
              sufficient_balance: usdcBalance >= checkout.amount
            };
            console.log(`💰 Patient wallet found: Balance $${walletInfo.balance.toFixed(2)} ${walletInfo.currency}`);
          }
        }
      }
    } catch (walletError) {
      console.warn('⚠️  Could not check wallet balance:', walletError.message);
      // Continue without wallet info
    }

    // Build payment link with better fallback logic
    // Priority: API_BASE_URL > BASE_URL > Railway URL (if detected) > production domain > localhost
    let baseUrl = process.env.API_BASE_URL || process.env.BASE_URL;
    if (!baseUrl) {
      // Check if running on Railway (common production environment)
      const railwayUrl = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN;
      if (railwayUrl) {
        baseUrl = `https://${railwayUrl}`;
      } else if (process.env.NODE_ENV === 'production') {
        // Production: use doclittle.site domain
        baseUrl = 'https://myskinandcare.com';
      } else {
        // Fallback to localhost for development
        baseUrl = 'http://localhost:4000';
      }
    }
    const paymentLink = `${baseUrl}/payment/${token}`;
    console.log(`🔗 Payment link: ${paymentLink}`);

    const emailDeliveryQueued = !TEST_MODE && !!checkout.customer_email;
    let emailResult = { success: false, error: null, queued: emailDeliveryQueued };
    try {
      if (emailDeliveryQueued) {
        const EmailService = require('./services/email-service');
        let appt = null;
        if (checkout.appointment_id) {
          appt = await db.getAppointment(checkout.appointment_id);
        }

        // Fire-and-forget: don't block identity verification on email delivery.
        EmailService.sendPaymentLinkEmail(checkout.customer_email, paymentLink, {
          product_name: checkout.product_name,
          amount: checkout.amount,
          wallet_balance: walletInfo?.balance,
          can_pay_from_wallet: walletInfo?.sufficient_balance,
          appointment_date: appt?.date,
          appointment_time: appt?.time,
          appointment_type: appt?.appointment_type || checkout.product_name
        }).catch((emailError) => {
          console.error('⚠️  Payment link email delivery failed:', emailError.message);
        });
      }
    } catch (emailSetupError) {
      emailResult = { success: false, error: emailSetupError.message, queued: false };
    }

    // Task 53: Mark token as identity-verified (required before payment redemption)
    db.updatePaymentToken(token, { status: 'verified', identity_verified_at: new Date().toISOString() });

    const verifyResponse = PaymentFlowService.buildLifecycleResponse({
      stage: 'identity_verified',
      nextAction: 'process_payment',
      message: TEST_MODE
        ? 'Identity verified (TEST_MODE: payment link email skipped)'
        : (emailResult.queued
            ? 'Identity verified (payment link email queued)'
            : (emailResult.error || 'Identity verified')),
      paymentToken: token,
      checkoutId: checkout.id,
      requiresVerification: false,
      wallet: walletInfo
    });
    PaymentFlowService.logTransition('identity_verified', {
      checkout_id: checkout.id,
      appointment_id: checkout.appointment_id,
      clinic_id: checkout.clinic_id,
      merchant_id: checkout.merchant_id
    });
    return res.json(verifyResponse);
  } catch (error) {
    console.error('❌ Error verifying email code:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/voice/orders/tracking', async (req, res) => {
  try {
    console.log('\n📦 VOICE: Order Tracking Request');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const TrackingService = require('./services/tracking-service');

    // Handle both Retell format and direct format
    let order_id, customer_email, customer_phone;

    if (req.body.args) {
      // Retell format
      order_id = req.body.args.order_id;
      customer_email = req.body.args.customer_email;
      customer_phone = req.body.args.customer_phone;
    } else {
      // Direct format
      order_id = req.body.order_id;
      customer_email = req.body.customer_email;
      customer_phone = req.body.customer_phone;
    }

    console.log('Order ID:', order_id || 'not provided');
    console.log('Customer Email:', customer_email || 'not provided');
    console.log('Customer Phone:', customer_phone || 'not provided');

    let order = null;

    // Try to find order by ID first
    if (order_id) {
      order = db.getOrder(order_id);
    }

    // CRITICAL: Get merchant_id from metadata to scope order search
    const merchant_id = req.body.metadata?.merchant_id ||
      req.body.merchant_id ||
      req.body.args?.merchant_id;

    // If not found by ID, search by customer email or phone (scoped to merchant)
    if (!order && (customer_email || customer_phone)) {
      // Scope search to merchant_id if available
      const ordersToSearch = merchant_id
        ? db.getOrdersByMerchant(merchant_id)
        : db.getAllOrders();

      order = ordersToSearch.find(o => {
        const emailMatch = customer_email && o.customer_email &&
          o.customer_email.toLowerCase() === customer_email.toLowerCase();
        const phoneMatch = customer_phone && o.customer_phone &&
          o.customer_phone.replace(/\D/g, '') === customer_phone.replace(/\D/g, '');
        return emailMatch || phoneMatch;
      });

      // If multiple orders found, get the most recent one
      if (!order && ordersToSearch.length > 0) {
        const matchingOrders = ordersToSearch.filter(o => {
          const emailMatch = customer_email && o.customer_email &&
            o.customer_email.toLowerCase() === customer_email.toLowerCase();
          const phoneMatch = customer_phone && o.customer_phone &&
            o.customer_phone.replace(/\D/g, '') === customer_phone.replace(/\D/g, '');
          return emailMatch || phoneMatch;
        });

        if (matchingOrders.length > 0) {
          // Sort by created_at descending and get most recent
          order = matchingOrders.sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
          )[0];
        }
      }
    }

    // Verify order belongs to merchant if merchant_id is available
    if (order && merchant_id && order.merchant_id !== merchant_id) {
      console.warn(`⚠️  Order ${order.id} does not belong to merchant ${merchant_id}`);
      order = null; // Don't return order from different merchant
    }

    if (!order) {
      console.log('❌ Order not found');
      return res.json({
        success: true,
        found: false,
        message: 'I couldn\'t find an order matching that information. Could you please provide your order number or email address?'
      });
    }

    console.log('✅ Order found:', order.id);
    console.log('   Status:', order.delivery_status || order.status);
    console.log('   Driver:', order.driver_name || 'not assigned');

    // Get tracking summary formatted for voice
    const trackingSummary = TrackingService.getTrackingSummary(order);

    // Parse tracking events if available
    let trackingEvents = [];
    if (order.tracking_events) {
      try {
        trackingEvents = typeof order.tracking_events === 'string'
          ? JSON.parse(order.tracking_events)
          : order.tracking_events;
      } catch (e) {
        console.warn('⚠️  Failed to parse tracking_events');
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    res.json({
      success: true,
      found: true,
      order_id: order.id,
      message: trackingSummary.message,
      delivery_status: order.delivery_status || order.status,
      driver_name: order.driver_name || null,
      driver_phone: order.driver_phone || null,
      current_location: order.current_latitude && order.current_longitude ? {
        latitude: order.current_latitude,
        longitude: order.current_longitude,
        address: order.current_address || null
      } : null,
      estimated_arrival: order.estimated_arrival || null,
      last_update: order.last_location_update || order.updated_at,
      events: trackingEvents.slice(-5) // Last 5 events for voice context
    });

  } catch (error) {
    console.error('❌ Voice order tracking error:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/voice/checkout/create', scheduleCheckoutLimiter, async (req, res) => {
  try {
    console.log('\n💳 VOICE: Creating Checkout via Orchestrator');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    safeLogRequestBody('Raw Retell data:', req);

    // EXTRACT ARGS: Handle multiple Retell formats
    // 1. Webhook: req.body.tool_call.args
    // 2. Direct function call: req.body.args
    // 3. Direct HTTP: req.body
    let args = req.body;

    if (req.body.tool_call && req.body.tool_call.args) {
      console.log('📥 Extracting from webhook tool_call.args');
      args = req.body.tool_call.args;
    } else if (req.body.args) {
      console.log('📥 Extracting from direct args');
      args = req.body.args;
    } else {
      console.log('📥 Using body directly');
    }

    console.log('Extracted args:', JSON.stringify(sanitizeForLog(args), null, 2));

    // CRITICAL: Get merchant_id from metadata (from voice/incoming handler)
    // Fallback to args if not in metadata
    const merchant_id = req.body.metadata?.merchant_id ||
      args.merchant_id ||
      req.body.merchant_id;

    if (!merchant_id) {
      console.error('❌ ERROR: merchant_id is missing from voice checkout creation');
      return res.status(400).json({
        success: false,
        error: 'merchant_id is required',
        message: 'Merchant ID not found in call metadata. This may indicate the customer has not completed onboarding.'
      });
    }

    console.log(`✅ Using merchant_id: ${merchant_id} for checkout creation`);

    // TRANSFORM: Retell flat format → PaymentRequest nested format
    const transformedData = {
      merchant_id: merchant_id, // Use from metadata
      customer: {
        name: args.customer_name || null,
        phone: args.customer_phone || null,  // Will be normalized by SMSService
        email: args.customer_email || null
      },
      items: [
        {
          product_id: args.product_id,
          quantity: args.quantity || 1
        }
      ],
      payment: {
        method: 'link',  // Voice always uses SMS link
        currency: 'USD'
      },
      source: {
        protocol: 'voice',
        platform: 'retell',
        input_type: 'voice'
      },
      metadata: {
        call_sid: args.call_sid || req.body.call?.call_id || null,
        original_request: req.body
      }
    };

    console.log('Transformed data:', JSON.stringify(transformedData, null, 2));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Call the orchestrator
    const response = await PaymentOrchestrator.createCheckout(transformedData);

    console.log('Orchestrator response:', {
      success: response.success,
      checkout_id: response.checkout_id,
      sms_sent: response.metadata?.sms_sent
    });

    // ========== CUSTOMER CREATION ==========
    // Create or get customer from checkout (for cannabis e-commerce)
    if (response.isSuccess() && args.customer_phone) {
      try {
        const CustomerService = require('./services/customer-service');
        const merchantId = args.tenantContext?.merchant?.id ||
          args.tenantContext?.clinic?.merchant_id ||
          response.metadata?.merchant_id ||
          merchant_id ||
          null;

        // Get checkout record to pass to customer service
        const checkout = await db.getVoiceCheckout(response.checkout_id);
        if (checkout) {
          const customer = CustomerService.getOrCreateCustomerFromCheckout(checkout, merchantId);
          console.log(`[CUSTOMER] ✅ Customer ${customer.id} ready for checkout ${response.checkout_id}`);
        }
      } catch (customerError) {
        console.warn('[CUSTOMER] ⚠️ Error creating customer from checkout (non-fatal):', customerError.message);
        // Continue with checkout even if customer creation fails
      }
    }

    // ========== FHIR INTEGRATION (OPTIONAL - Only if therapy booked) ==========
    // Only create FHIR Patient if customer explicitly books a therapy appointment
    // For cannabis e-commerce, most customers won't need FHIR Patient records
    if (response.isSuccess() && args.customer_phone && args.book_therapy === true) {
      try {
        // Get merchant_id from tenant context or checkout
        const merchantId = args.tenantContext?.merchant?.id ||
          args.tenantContext?.clinic?.merchant_id ||
          response.metadata?.merchant_id ||
          merchant_id ||
          null;

        // Find or create FHIR patient with merchant_id (only if therapy is booked)
        const patient = await FHIRService.getOrCreatePatient({
          phone: args.customer_phone,
          email: args.customer_email,
          name: args.customer_name,
          merchant_id: merchantId
        });

        // Update checkout with FHIR patient ID
        await db.updateVoiceCheckout(response.checkout_id, {
          fhir_patient_id: patient.id
        });

        // Link customer to FHIR Patient
        const CustomerService = require('./services/customer-service');
        const checkoutForLink = await db.getVoiceCheckout(response.checkout_id);
        if (checkoutForLink) {
          const customer = CustomerService.getOrCreateCustomerFromCheckout(checkoutForLink, merchantId);
          if (customer && customer.id) {
            db.updateCustomer(customer.id, { fhir_patient_id: patient.id });
            console.log(`[FHIR] ✅ Linked customer ${customer.id} to FHIR Patient ${patient.id}`);
          }
        }

        console.log(`[FHIR] ✅ Linked checkout ${response.checkout_id} to Patient ${patient.id}${merchantId ? ` (merchant: ${merchantId})` : ''} (therapy booked)`);

        // Auto-create wallet for patient (if Circle is available)
        if (patient.id && merchantId) {
          try {
            const CircleService = require('./services/circle-service');
            const walletResult = await CircleService.getOrCreatePatientWallet(patient.id, {
              createIfNotExists: true,
              merchantId: merchantId
            });
            if (walletResult.success) {
              console.log(`[FHIR] ✅ Auto-created wallet for patient ${patient.id}`);
            } else {
              console.log(`[FHIR] ⚠️  Wallet creation skipped: ${walletResult.error}`);
            }
          } catch (walletError) {
            console.warn(`[FHIR] ⚠️  Wallet creation error (non-fatal):`, walletError.message);
          }
        }

        // If this is a medication/supplement product, create MedicationRequest
        if (response.metadata?.product) {
          const product = response.metadata.product;
          // Check if product is health-related (you can customize this logic)
          if (product.category === 'supplements' || product.category === 'medication') {
            await FHIRService.createMedicationRequest({
              patientId: patient.id,
              productName: product.name,
              productId: product.id,
              orderId: response.checkout_id,
              price: response.payment.amount,
              status: 'active'
            });
            console.log(`[FHIR] ✅ Created MedicationRequest for product: ${product.name}`);
          }
        }
      } catch (fhirError) {
        console.error('[FHIR] ⚠️ Error linking checkout to FHIR:', fhirError.message);
        // Continue with checkout even if FHIR fails
      }
    }
    // ======================================

    // Return response in Retell-friendly format
    if (response.isSuccess()) {
      console.log('✅ Checkout created successfully');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      res.json({
        success: true,
        checkout_id: response.checkout_id,
        amount: response.payment.amount,
        currency: response.payment.currency,
        payment_token: response.payment_token || response.metadata?.payment_token,
        status: response.payment.status,
        message: response.message,
        requires_verification: response.metadata?.verification_required || false,
        email_sent: response.metadata?.email_sent || false,
        metadata: {
          product: response.metadata?.product,
          customer_phone_normalized: transformedData.customer.phone,
          fraud_check: response.metadata?.fraud_check
        }
      });
    } else {
      console.error('❌ Checkout failed:', response.error);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      res.status(400).json({
        success: false,
        error: response.error,
        details: response.metadata
      });
    }

  } catch (error) {
    console.error('❌ Voice checkout error:', error);
    console.error('Stack:', error.stack);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    res.status(500).json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.post('/voice/appointments/schedule', scheduleCheckoutLimiter, async (req, res) => {
  try {
    console.log('\n📅 VOICE: Schedule Appointment');
    safeLogRequestBody('Request body:', req);

    // Extract args (handle Retell formats)
    let args = req.body.args || req.body;
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to schedule appointments'
      });
    }

    // Extract customer_id from metadata (set during call registration)
    let customerId = null;
    if (args.metadata && args.metadata.customer_id) {
      customerId = args.metadata.customer_id;
    } else if (args.customer_id) {
      customerId = args.customer_id;
    } else if (req.body.metadata && req.body.metadata.customer_id) {
      customerId = req.body.metadata.customer_id;
    } else {
      // Try to find customer by clinic_id (legacy support)
      const clinic = await db.getClinicById(clinicId);
      if (clinic && clinic.merchant_id) {
        // Ensure a tenant-level customer exists for this clinic.
        const ensuredCustomerId =
          db.ensureCustomerIdForClinic?.(clinicId) ||
          db.getCustomerIdForClinic?.(clinicId) ||
          null;

        if (ensuredCustomerId) {
          customerId = ensuredCustomerId;
        } else {
          console.warn(`⚠️  No customer_id found for clinic ${clinicId}. Appointment will be created without tenant isolation.`);
        }
      }
    }

    const appointmentData = {
      patient_name: args.patient_name,
      patient_phone: args.patient_phone,
      patient_email: args.patient_email,
      patient_id: args.patient_id || args.confirmed_patient_id || null,
      appointment_type: args.appointment_type || 'Mental Health Consultation',
      date: args.date,  // YYYY-MM-DD
      time: args.time,  // HH:MM or "2:00 PM"
      duration_minutes: args.duration_minutes || 50,
      provider: args.provider,
      practitioner_id: args.practitioner_id || null,
      notes: args.notes,
      timezone: args.timezone || 'America/New_York',
      clinic_id: clinicId,
      customer_id: customerId,
      // W3-S4.2: Resolved ICD/CPT from triage for billing
      primary_icd10: args.primary_icd10 || null,
      primary_cpt: args.primary_cpt || null
    };

    if (!requireVoiceSessionIdForTriageParity(req, res)) return;

    // Phase 5: Backend guardrails when session_id / call_id present (Kelly + Retell direct parity)
    const sessionIdForGuard = resolveVoiceSessionIdForGuard(args, req);
    if (!enforceVoiceTriageGuardrailsForSession(sessionIdForGuard, args, res, 'schedule')) return;

    // S4: hard-stop wrong linkage when a known patient_id name disagrees unless explicitly confirmed.
    if (appointmentData.patient_id && appointmentData.patient_name && db.getFHIRPatient) {
      try {
        const existing = db.getFHIRPatient(appointmentData.patient_id);
        const existingName = String(existing?.name || '').trim();
        const providedName = String(appointmentData.patient_name || '').trim();
        const allowNameMismatch =
          args.confirm_name_mismatch === true ||
          String(args.confirm_name_mismatch || '').toLowerCase() === 'true';
        if (existingName && providedName && !namesMatch(existingName, providedName) && !allowNameMismatch) {
          return res.status(409).json({
            success: false,
            error: 'NAME_MISMATCH',
            requires_name_confirmation: true,
            patient_id: appointmentData.patient_id,
            expected_name: existingName,
            provided_name: providedName,
            next_step: 'Confirm this is the same person, then retry with confirm_name_mismatch=true, or use the correct patient_id.'
          });
        }
      } catch (_) {}
    }

    const result = await BookingService.scheduleAppointment(appointmentData);
    if (result.success) invalidateSlotAvailabilityCache();

    // S1: duplicate detection should return explicit actionable 409 for voice clients.
    if (!result.success && result.duplicate && result.requiresPhoneConfirmation) {
      return res.status(409).json({
        ...result,
        error_code: 'DUPLICATE_PATIENT_PHONE_CONFIRMATION_REQUIRED',
        next_step: 'Ask the patient to confirm phone number. If it matches an existing patient, retry with confirmed_patient_id. Otherwise collect corrected contact details.'
      });
    }

    // Auto-checkout is intentionally centralized in KellyToolExecutor to avoid multi-path duplicate checkout creation.

    res.json(result);
  } catch (error) {
    console.error('❌ Error scheduling appointment:', error);
    const payload = { success: false, error: error.message };
    if (error.slot_conflict && Array.isArray(error.alternative_slots)) {
      payload.slot_conflict = true;
      payload.alternative_slots = error.alternative_slots;
    }
    res.status(500).json(payload);
  }
});

app.post('/voice/patient/intake', async (req, res) => {
  try {
    const args = req.body.args || req.body || {};
    const patient_id = (args.patient_id || args.patientId || '').toString().trim();
    const patient_email = (args.patient_email || args.email || '').toString().trim().toLowerCase();
    let patient_phone = (args.patient_phone || args.phone || '').toString().trim();

    // Validation (voice onboarding requirements)
    const dobRaw = (args.dob || args.date_of_birth || '').toString().trim();
    const countryRaw = (args.country || '').toString().trim();
    const cityRaw = (args.city || '').toString().trim();

    // Normalize phone early so patient resolution is stable
    if (patient_phone) {
      try {
        const SMSService = require('./services/sms-service');
        patient_phone = SMSService.formatPhoneNumber ? SMSService.formatPhoneNumber(patient_phone) : patient_phone;
      } catch (_) {}
    }

    const errors = [];
    if (dobRaw) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobRaw);
      if (!m) {
        errors.push('dob must be in YYYY-MM-DD format');
      } else {
        const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
        const dt = new Date(Date.UTC(y, mo - 1, d));
        const valid = dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === mo && dt.getUTCDate() === d;
        if (!valid) errors.push('dob is not a valid calendar date');
      }
    } else {
      errors.push('dob is required');
    }
    if (!countryRaw) errors.push('country is required');
    if (!cityRaw) errors.push('city is required');

    if (errors.length) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_validation_failed'); } catch (_) {}
      return res.status(400).json({
        success: false,
        error: errors.join('; '),
        message: "I couldn’t save that; let’s try again."
      });
    }

    let patientId = patient_id || null;
    if (!patientId && patient_email) {
      try { patientId = db.getFHIRPatientByEmail(patient_email)?.resource_id || null; } catch (_) {}
    }
    if (!patientId && patient_phone) {
      try { patientId = db.getFHIRPatientByPhone(patient_phone)?.resource_id || null; } catch (_) {}
    }
    if (!patientId && (patient_email || patient_phone || args.first_name || args.last_name || args.patient_name)) {
      try {
        const nm = (args.patient_name || [args.first_name, args.last_name].filter(Boolean).join(' ') || 'Unknown').toString();
        const created = await FHIRService.getOrCreatePatient({
          name: nm,
          phone: patient_phone || undefined,
          email: patient_email || undefined
        }, false);
        patientId = created?.patient?.id || null;
      } catch (_) {}
    }

    if (!patientId) {
      return res.status(400).json({ success: false, error: 'Unable to resolve patient_id (provide patient_id, patient_email, or patient_phone)' });
    }

    const payload = {
      first_name: args.first_name || '',
      last_name: args.last_name || '',
      dob: dobRaw,
      phone: patient_phone || '',
      email: patient_email || '',
      country: countryRaw,
      city: cityRaw,
      city_place_id: args.city_place_id || ''
    };
    if (args.insurance && typeof args.insurance === 'object') {
      payload.insurance = args.insurance;
    }
    const result = await PatientIntakeService.upsertIntakeByPatientId(patientId, payload);
    if (!result.success) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_save_failed'); } catch (_) {}
      return res.status(400).json({
        ...result,
        message: "I couldn’t save that; let’s try again."
      });
    }
    try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_save_success'); } catch (_) {}
    if (Array.isArray(result.missing_fields) && result.missing_fields.length) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_missing_fields'); } catch (_) {}
    }
    return res.json({
      ...result,
      message: "Thanks — you’re all set."
    });
  } catch (e) {
    try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_save_error'); } catch (_) {}
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/voice/patient/intake/status', async (req, res) => {
  try {
    const args = req.body.args || req.body || {};
    const patient_id = (args.patient_id || args.patientId || '').toString().trim();
    const patient_email = (args.patient_email || args.email || '').toString().trim().toLowerCase();
    let patient_phone = (args.patient_phone || args.phone || '').toString().trim();
    if (patient_phone) {
      try {
        const SMSService = require('./services/sms-service');
        patient_phone = SMSService.formatPhoneNumber ? SMSService.formatPhoneNumber(patient_phone) : patient_phone;
      } catch (_) {}
    }

    let patientId = patient_id || null;
    if (!patientId && patient_email) {
      try { patientId = db.getFHIRPatientByEmail(patient_email)?.resource_id || null; } catch (_) {}
    }
    if (!patientId && patient_phone) {
      try { patientId = db.getFHIRPatientByPhone(patient_phone)?.resource_id || null; } catch (_) {}
    }

    if (!patientId) {
      const missing_fields = ['dob', 'country', 'city'];
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_status_patient_not_found'); } catch (_) {}
      return res.json({
        success: true,
        patient_id: null,
        onboarding_complete: false,
        missing_fields
      });
    }

    const row = db.getFHIRPatient(patientId);
    const canonical = PatientIntakeService.canonicalFromPatientResource(row?.resource_data || {});
    const status = PatientIntakeService.onboardingStatusFromCanonical(canonical);
    if (status?.onboarding_complete) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_status_complete'); } catch (_) {}
    } else {
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_status_incomplete'); } catch (_) {}
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_missing_fields'); } catch (_) {}
    }
    return res.json({
      success: true,
      patient_id: patientId,
      ...status
    });
  } catch (e) {
    try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_status_error'); } catch (_) {}
    return res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

app.post('/voice/appointments/confirm', async (req, res) => {
  try {
    console.log('\n✅ VOICE: Confirm Appointment');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;
    const appointmentId = args.appointment_id || args.confirmation_number;
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to confirm appointments'
      });
    }

    const result = await BookingService.confirmAppointment(appointmentId, clinicId);

    res.json(result);
  } catch (error) {
    console.error('❌ Error confirming appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/voice/appointments/reschedule', async (req, res) => {
  try {
    console.log('\n🔄 VOICE: Reschedule Appointment');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;
    if (!requireVoiceSessionIdForTriageParity(req, res)) return;

    const appointmentId = args.appointment_id || args.confirmation_number;
    const newDate = args.new_date || args.date;
    const newTime = args.new_time || args.time;
    const reason = args.reason || null;
    const timezone = args.timezone || null;
    if (timezone && !isValidIanaTimezone(timezone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid timezone. Expected a valid IANA timezone like "America/New_York".'
      });
    }
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to reschedule appointments'
      });
    }

    if (!newDate || !newTime) {
      return res.status(400).json({
        success: false,
        error: 'new_date and new_time are required for rescheduling'
      });
    }

    const result = await BookingService.rescheduleAppointment(
      appointmentId,
      newDate,
      newTime,
      reason,
      timezone,
      clinicId
    );
    if (result?.success) invalidateSlotAvailabilityCache();

    res.json(result);
  } catch (error) {
    console.error('❌ Error rescheduling appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/voice/appointments/cancel', async (req, res) => {
  try {
    console.log('\n❌ VOICE: Cancel Appointment');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;
    const appointmentId = args.appointment_id || args.confirmation_number;
    const reason = args.reason || null;
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to cancel appointments'
      });
    }

    const result = await BookingService.cancelAppointment(appointmentId, reason, clinicId);
    if (result?.success) invalidateSlotAvailabilityCache();

    res.json(result);
  } catch (error) {
    console.error('❌ Error cancelling appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/voice/appointments/available-slots', async (req, res) => {
  try {
    const args = req.body.args || req.body;
    if (!requireVoiceSessionIdForTriageParity(req, res)) return;

    const date = args.date;  // YYYY-MM-DD
    const provider = args.provider || null;
    const appointmentType = args.appointment_type || null;
    const timezone = args.timezone || 'America/New_York';
    if (!isValidIanaTimezone(timezone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid timezone. Expected a valid IANA timezone like "America/New_York".'
      });
    }
    const lane = args.lane || 'sync';
    const clinicId = resolveClinicIdFromRequest(req, args) || args.clinic_id;
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to check availability'
      });
    }

    const sessionIdForGuard = resolveVoiceSessionIdForGuard(args, req);
    if (!enforceVoiceTriageGuardrailsForSession(sessionIdForGuard, args, res, 'slots')) return;

    const practitionerId = args.practitioner_id || null;
    const cache = require('./services/cache-service');
    const cacheSession = sessionIdForGuard || 'no_session';
    // C10: namespace cache when REQUIRE_TRIAGE_FOR_VOICE flips so stale no_session entries are not reused
    const rtfvSeg =
      process.env.REQUIRE_TRIAGE_FOR_VOICE === '1' || process.env.REQUIRE_TRIAGE_FOR_VOICE === 'true'
        ? 'rtfv1'
        : 'rtfv0';
    const cacheKey = [clinicId, date || '', provider || '', appointmentType || '', timezone || '', practitionerId || '', lane || '', cacheSession, rtfvSeg].join('|');
    const cached = cache.get('slot_availability', cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Specialist path: when appointment_type is a specialty, use Resolver + specialist slots
    // W3-S5.3/W3-S5.4: Use language + state from session when call_id provided
    const { isSpecialtyType } = require('./services/specialist-slot-service');
    if (isSpecialtyType(appointmentType)) {
      try {
        const SpecialistResolverService = require('./services/specialist-resolver-service');
        const { getAvailableSlotsWithSpecialist } = require('./services/specialist-slot-service');
        let language = 'en';
        let patientState = null;
        const callId = args.call_id || args.session_id || sessionIdForGuard || null;
        let urgency = args.urgency || 'routine';
        if (callId && db) {
          try {
            if (db.getKellySessionLanguage) language = db.getKellySessionLanguage(callId) || language;
            const triageRow = db.getTriageSession ? db.getTriageSession(callId) : null;
            if (!language && triageRow?.detected_language) language = triageRow.detected_language;
            if (triageRow?.urgency) urgency = triageRow.urgency;
            if (db.getOrchestrateSessionBySessionId) {
              const row = db.getOrchestrateSessionBySessionId(callId);
              patientState = row?.flow_state?.patient_state || row?.flow_state?.state || null;
            }
            const ragResult = require('./services/triage-rag-service').getLatestForSession?.(callId);
            if (ragResult?.urgency) urgency = ragResult.urgency;
          } catch (_) {}
        }
        const patientTier = 2;
        const resolverResult = await SpecialistResolverService.resolve({
          clinicId,
          specialty: appointmentType,
          language,
          state: patientState,
          lane,
          urgency,
          patientTier,
          date
        });
        if (resolverResult.providers && resolverResult.providers.size > 0) {
          const slots = await getAvailableSlotsWithSpecialist({
            date,
            lane,
            providerMap: resolverResult.providers,
            clinicId,
            timezone,
            appointmentType
          });
          const result = {
            success: true,
            available_slots: slots.map(s => s.time === 'ASYNC' ? `Async review — ${s.practitioner_name}` : s.time),
            slot_bundles: slots,
            appointment_type: appointmentType,
            kelly_script: resolverResult.kellyScript
          };
          // M-S5.A: say_to_patient so LLM says kelly_script verbatim
          if (resolverResult.kellyScript) {
            result.say_to_patient = `Say this to the patient before presenting slots: "${resolverResult.kellyScript}"`;
          }
          cache.set('slot_availability', result, cacheKey);
          return res.json(result);
        }
      } catch (specErr) {
        console.warn('⚠️  Specialist slot path failed, falling back to standard:', specErr.message);
      }
    }

    const resultRaw = await BookingService.getAvailableSlots(date, provider, appointmentType, timezone, clinicId, practitionerId);
    const result = ensureSlotBundles(resultRaw, date, practitionerId);
    if (result.success) {
      cache.set('slot_availability', result, cacheKey);
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Error getting available slots:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/voice/appointments/search', async (req, res) => {
  try {
    console.log('\n🔍 VOICE: Search Appointments');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;
    const searchTerm = args.phone || args.email || args.patient_phone || args.patient_email;
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to search appointments'
      });
    }

    const result = await BookingService.searchAppointments(searchTerm, clinicId);

    res.json(result);
  } catch (error) {
    console.error('❌ Error searching appointments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/voice/insurance/collect', async (req, res) => {
  try {
    console.log('\n🏥 VOICE: Collect Insurance Information');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;

    // C4: Same session id requirement as schedule/slots when REQUIRE_TRIAGE_FOR_VOICE=1
    if (!requireVoiceSessionIdForTriageParity(req, res)) return;

    // Required: member_id
    if (!args.member_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: member_id'
      });
    }

    // Phase 5: Same DB triage guardrails as schedule/slots (impl-1); uses resolveVoiceSessionIdForGuard (session_id > metadata > call_id)
    const insuranceSessionId = resolveVoiceSessionIdForGuard(args, req);
    if (!enforceVoiceTriageGuardrailsForSession(insuranceSessionId, args, res, 'insurance')) return;

    // Optional: patient_id to link insurance to patient
    const patientId = args.patient_id || args.patientId || null;
    // Bug 5: Normalize phone for consistent lookups (getFHIRPatientByPhone, findOrCreatePatient)
    let patientPhone = (args.patient_phone || args.phone || '').toString().trim();
    if (patientPhone) {
      try {
        const SMSService = require('./services/sms-service');
        patientPhone = SMSService.formatPhoneNumber ? SMSService.formatPhoneNumber(patientPhone) : patientPhone.replace(/\D/g, '');
      } catch (_) {
        patientPhone = patientPhone.replace(/\D/g, '');
      }
    }
    patientPhone = patientPhone || null;
    const patientName = args.patient_name || args.customer_name || null;
    const patientEmail = args.patient_email || args.customer_email || null;

    // ==========================================
    // FRAUD DETECTION: Name Validation
    // ==========================================
    const callId = args.call_id || null;
    const initialName = args.initial_name || null;

    // V-3: Get initial name from DB (works in multi-instance; no retellHandler dependency)
    let storedInitialName = initialName;
    if (callId && !storedInitialName && db?.getOrchestrateSessionBySessionId) {
      try {
        const row = db.getOrchestrateSessionBySessionId(callId);
        storedInitialName = row?.flow_state?.initial_name || null;
      } catch (error) {
        console.warn('⚠️  Could not get initial name from session:', error.message);
      }
    }

    // Validate name match if we have both initial name and provided name
    if (storedInitialName && patientName) {
      const namesMatchResult = namesMatch(storedInitialName, patientName);

      if (!namesMatchResult) {
        // FRAUD DETECTED: Names don't match
        console.error('\n🚨 FRAUD DETECTION ALERT: Name Mismatch');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error(`   Initial Name: "${storedInitialName}"`);
        console.error(`   Provided Name: "${patientName}"`);
        console.error(`   Call ID: ${callId || 'N/A'}`);
        console.error(`   Member ID: ${args.member_id}`);
        console.error(`   Phone: ${patientPhone || 'N/A'}`);
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Log fraud attempt to database
        try {
          const fraudLogId = require('uuid').v4();
          db.db.prepare(`
            INSERT INTO fraud_attempts (
              id, call_id, patient_phone, initial_name, provided_name,
              member_id, fraud_type, risk_score, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            fraudLogId,
            callId,
            patientPhone,
            storedInitialName,
            patientName,
            args.member_id,
            'name_mismatch',
            90, // High risk score for name mismatch
            new Date().toISOString()
          );
          console.log(`✅ Fraud attempt logged: ${fraudLogId}`);
        } catch (logError) {
          console.error('❌ Could not log fraud attempt:', logError.message);
        }

        // Return error - DO NOT process insurance with mismatched name
        return res.status(403).json({
          success: false,
          error: 'Name verification failed. The name provided does not match the name you provided at the start of the call.',
          fraud_detected: true,
          fraud_type: 'name_mismatch',
          initial_name: storedInitialName,
          provided_name: patientName,
          message: 'For security reasons, we cannot process insurance information when the name does not match. Please verify your information and try again, or speak with a representative.',
          requires_verification: true
        });
      } else {
        console.log(`✅ Name validation passed: "${storedInitialName}" matches "${patientName}"`);
      }
    } else if (storedInitialName && !patientName) {
      // Initial name exists but no name provided in insurance collection
      // This might be okay if name is optional, but log it
      console.warn(`⚠️  Initial name stored (${storedInitialName}) but no name provided in insurance collection`);
    } else if (!storedInitialName && patientName && callId) {
      // No initial name stored yet - persist to DB (V-3: multi-instance safe)
      try {
        const row = db?.getOrchestrateSessionBySessionId?.(callId);
        const existingState = row?.flow_state || {};
        if (db?.upsertOrchestrateSession) {
          db.upsertOrchestrateSession({
            session_id: callId,
            channel: 'voice',
            patient_id: row?.patient_id || null,
            caller_phone: row?.caller_phone || patientPhone,
            clinic_id: row?.clinic_id || null,
            conversation_history: row?.conversation_history || [],
            flow_state: { ...existingState, initial_name: patientName.trim() }
          });
          console.log(`✅ Stored initial name from insurance collection: ${patientName}`);
        }
      } catch (error) {
        console.warn('⚠️  Could not store initial name:', error.message);
      }
    }

    // Try to find patient by phone if patient_id not provided
    // RULE: Phone number is the primary unique identifier for patients
    let foundPatient = null;
    if (!patientId && patientPhone) {
      try {
        foundPatient = db.getFHIRPatientByPhone(patientPhone);
        if (foundPatient) {
          console.log(`✅ Found patient by phone: ${foundPatient.resource_id}`);
          patientId = foundPatient.resource_id;

          // Verify name matches if provided (for fraud detection)
          if (patientName && foundPatient.name) {
            const FHIRService = require('./services/fhir-service');
            if (!FHIRService.namesMatch(patientName, foundPatient.name)) {
              console.warn(`⚠️  Name mismatch: Provided "${patientName}" but patient record has "${foundPatient.name}"`);
              // Still use the patient found by phone (phone is more reliable)
            }
          }
        }
      } catch (error) {
        console.warn('⚠️  Could not find patient by phone:', error.message);
      }
    }

    // If patient not found by phone, try to find by name (but require phone confirmation if duplicates exist)
    if (!foundPatient && patientName && !patientPhone) {
      console.warn('⚠️  Patient name provided but no phone number - phone number is required for duplicate detection');
    }

    // If patient found, try to get their insurance from database
    let payerId = args.payer_id || null;
    let payerName = args.payer_name || null;

    if (foundPatient && !payerId && !payerName) {
      try {
        // Try to get patient's insurance from database
        const patientInsurance = db.db.prepare(`
          SELECT * FROM patient_insurance 
          WHERE patient_id = ? AND member_id = ?
          ORDER BY created_at DESC LIMIT 1
        `).get(foundPatient.resource_id, args.member_id);

        if (patientInsurance) {
          payerId = patientInsurance.payer_id;
          payerName = patientInsurance.payer_name;
          console.log(`✅ Found insurance in database: ${payerName} (${payerId})`);
        }
      } catch (error) {
        console.warn('⚠️  Could not find insurance in database:', error.message);
      }
    }

    // If still no payer info, try to look up by member_id history
    if (!payerId && !payerName) {
      // For demo: Try common payers or look up from existing eligibility checks
      try {
        const eligibilityCheck = db.db.prepare(`
          SELECT payer_id, payer_name FROM eligibility_checks 
          WHERE member_id = ? 
          ORDER BY created_at DESC LIMIT 1
        `).get(args.member_id);

        if (eligibilityCheck) {
          payerId = eligibilityCheck.payer_id;
          payerName = eligibilityCheck.payer_name;
          console.log(`✅ Found payer from eligibility history: ${payerName} (${payerId})`);
        }
      } catch (error) {
        console.warn('⚠️  Could not find payer from eligibility history:', error.message);
      }
    }

    // Step 1: Get or validate payer information
    let validationResult = null;

    // If we already have payer_id from database lookup, validate it
    if (payerId && payerName) {
      // Validate they match
      const payer = db.getPayerByPayerId(payerId);
      if (payer && payer.payer_name === payerName) {
        validationResult = {
          success: true,
          payer_id: payerId,
          payer_name: payerName,
          member_id: args.member_id,
          apiCallSaved: true
        };
      }
    }

    // If we don't have validation result yet, try to get it
    if (!validationResult) {
      if (payerId && !payerName) {
        // We have payer_id but no payer_name - get payer name from database
        const payer = db.getPayerByPayerId(payerId);
        if (payer) {
          payerName = payer.payer_name;
          validationResult = {
            success: true,
            payer_id: payerId,
            payer_name: payerName,
            member_id: args.member_id,
            apiCallSaved: true
          };
        }
      } else if (payerName || args.payer_name) {
        // Validate payer name and get payer_id (use payerName from lookup or args.payer_name)
        const payerNameToValidate = payerName || args.payer_name;
        validationResult = await PayerCacheService.validatePatientInsurance(
          payerNameToValidate,
          args.member_id
        );

        if (!validationResult.success) {
          return res.json({
            success: false,
            error: validationResult.error,
            suggestions: validationResult.suggestions || []
          });
        }

        // If multiple matches, return suggestions for voice agent to confirm
        if (validationResult.multipleMatches) {
          return res.json({
            success: true,
            confirmed: false,
            multipleMatches: true,
            suggestions: validationResult.suggestions,
            message: validationResult.message,
            apiCallSaved: validationResult.apiCallSaved
          });
        }

        // Update payer_id and payer_name from validation
        if (validationResult.payer_id) {
          payerId = validationResult.payer_id;
          payerName = validationResult.payer_name;
        }
      } else {
        // No payer info at all - require payer_name
        return res.status(400).json({
          success: false,
          error: 'Missing required field: payer_name. Please provide insurance company name (e.g., Cigna, Aetna, Blue Cross).',
          requires_payer_name: true
        });
      }
    }

    // Step 2: Ensure we have a patient before checking eligibility
    // CRITICAL: Eligibility must be linked to a patient_id for proper retrieval
    let finalPatientId = patientId || (foundPatient ? foundPatient.resource_id : null);

    // If we have an email but no patient yet, try resolve by email (web OTP identity)
    if (!finalPatientId && patientEmail) {
      try {
        const byEmail = db.getFHIRPatientByEmail(patientEmail.trim().toLowerCase());
        if (byEmail) {
          finalPatientId = byEmail.resource_id;
          foundPatient = byEmail;
        }
      } catch (_) {}
    }

    // If no patient found yet, try to create or find by member_id in claims
    if (!finalPatientId && args.member_id) {
      // Try to find patient via claims (most reliable source)
      try {
        const claimRecord = db.db.prepare(`
          SELECT patient_id FROM insurance_claims 
          WHERE member_id = ? 
          ORDER BY submitted_at DESC 
          LIMIT 1
        `).get(args.member_id);

        if (claimRecord && claimRecord.patient_id) {
          finalPatientId = claimRecord.patient_id;
          foundPatient = db.getFHIRPatient(finalPatientId);
          console.log(`   ✅ Found patient via claims for member_id ${args.member_id}: ${finalPatientId}`);
        }
      } catch (error) {
        console.warn('⚠️  Could not find patient via claims:', error.message);
      }
    }

    // If still no patient and we have patient info, create patient
    if (!finalPatientId && (patientName || patientPhone || patientEmail)) {
      try {
        const FHIRService = require('./services/fhir-service');
        console.log('   📝 Creating/finding patient record for insurance collection...');

        const patientResult = await FHIRService.getOrCreatePatient({
          name: patientName || 'Unknown',
          phone: patientPhone,
          email: patientEmail
        }, true); // requirePhoneConfirmation = true

        // Check if duplicate was detected
        if (patientResult.duplicate && patientResult.requiresPhoneConfirmation) {
          console.log('   🚨 DUPLICATE DETECTED: Similar name found, phone confirmation required');

          // Return error response indicating phone confirmation is needed
          return res.status(409).json({
            success: false,
            duplicate: true,
            requiresPhoneConfirmation: true,
            error: patientResult.message || 'Duplicate patient found. Phone number confirmation required.',
            error_code: 'DUPLICATE_PATIENT_PHONE_CONFIRMATION_REQUIRED',
            duplicates: patientResult.duplicates || [],
            provided_name: patientResult.provided_name,
            provided_phone: patientResult.provided_phone,
            message: 'I found a patient with a similar name in our system. To verify your identity, please confirm your phone number. This helps ensure we have the correct patient record.',
            voice_agent_instruction: 'Ask the caller to confirm their phone number. If the phone number matches an existing patient, use that patient. If not, ask the caller to verify their information.',
            next_step: 'Confirm phone number (or email) and retry insurance collection with confirmed patient identity.'
          });
        }

        // Patient was found or created successfully
        if (patientResult.patient && patientResult.patient.id) {
          // Find the patient record in database
          const createdPatient = db.getFHIRPatient(patientResult.patient.id);
          if (createdPatient) {
            finalPatientId = createdPatient.resource_id;
            foundPatient = createdPatient;
            console.log(`   ✅ Patient record ${patientResult.foundBy}: ${finalPatientId}`);
          }
        } else if (patientResult.patient) {
          // Patient object might be the resource_data directly
          const createdPatient = db.getFHIRPatient(patientResult.patient.id || patientResult.patient.resource_id);
          if (createdPatient) {
            finalPatientId = createdPatient.resource_id;
            foundPatient = createdPatient;
            console.log(`   ✅ Patient record ${patientResult.foundBy}: ${finalPatientId}`);
          }
        }
      } catch (createError) {
        console.warn('⚠️  Could not create/find patient record:', createError.message);

        // If error is about phone number required, return helpful error
        if (createError.message && createError.message.includes('Phone number is required')) {
          return res.status(400).json({
            success: false,
            error: createError.message,
            requiresPhone: true,
            message: 'Phone number is required to create a new patient record. Please provide your phone number.'
          });
        }

        // For other errors, continue (don't block insurance collection)
      }
    }

    // Step 3: Check eligibility to get coverage details (if payer_id is available)
    let eligibilityResult = null;
    if (payerId && args.member_id) {
      try {
        const InsuranceService = require('./services/insurance-service');

        // Get patient info for eligibility check
        let finalPatientName = patientName || 'Patient';
        let dateOfBirth = '1990-01-01';

        if (foundPatient) {
          try {
            const patientData = typeof foundPatient.resource_data === 'string'
              ? JSON.parse(foundPatient.resource_data)
              : foundPatient.resource_data;

            if (patientData.name) {
              const nameParts = patientData.name[0];
              finalPatientName = nameParts.text ||
                (nameParts.given ? nameParts.given.join(' ') + ' ' + (nameParts.family || '') : 'Patient');
            }
            dateOfBirth = patientData.birthDate || dateOfBirth;
          } catch (parseError) {
            console.warn('⚠️  Could not parse patient data:', parseError.message);
          }
        }

        // W3-S4.6: Use resolved CPT from triage when call_id provided
        let serviceCode = args.service_code;
        if (!serviceCode && args.call_id) {
          try {
            const TriageRAGService = require('./services/triage-rag-service');
            const { getCptCodeForVisit } = require('./utils/cpt-helper');
            const triage = TriageRAGService.getLatestForSession(args.call_id);
            if (triage?.target_specialty) {
              serviceCode = getCptCodeForVisit({
                specialty: triage.target_specialty,
                isNewPatient: true,
                urgency: triage.urgency || 'routine'
              });
            }
          } catch (_) {}
        }
        serviceCode = serviceCode || (() => { try { return require('./utils/cpt-helper').getCptCodeForVisit({ specialty: 'PrimaryCare', urgency: 'routine', isNewPatient: true }); } catch (_) { return '99203'; } })();

        const eligibilityData = {
          patientId: finalPatientId,
          patientName: finalPatientName,
          dateOfBirth: dateOfBirth,
          memberId: args.member_id,
          payerId: payerId,
          serviceCode,
          diagnosisCode: args.primary_icd10 || null,
          dateOfService: args.date_of_service || new Date().toISOString().split('T')[0]
        };

        eligibilityResult = await InsuranceService.checkEligibility(eligibilityData);
        console.log('✅ Eligibility checked:', eligibilityResult.success ? 'Covered' : 'Not covered');

        // IMPORTANT: Update eligibility record with patient_id if it was missing
        if (finalPatientId && eligibilityResult.id) {
          try {
            // Update the eligibility record to link it to the patient
            db.db.prepare(`
              UPDATE eligibility_checks 
              SET patient_id = ?
              WHERE id = ?
            `).run(finalPatientId, eligibilityResult.id);
            console.log(`   ✅ Linked eligibility record ${eligibilityResult.id} to patient ${finalPatientId}`);
          } catch (updateError) {
            console.warn('⚠️  Could not update eligibility record with patient_id:', updateError.message);
          }
        }
      } catch (eligError) {
        console.warn('⚠️  Could not check eligibility:', eligError.message);
        // Continue without eligibility data
      }
    }

    // Step 4: Store insurance info (if we have a patient)
    // Note: finalPatientId was already determined in Step 2
    let storedInsurance = null;

    if (finalPatientId && payerId && payerName) {
      // Store in patient_insurance table
      const { v4: uuidv4 } = require('uuid');
      const insuranceRecord = {
        id: `ins_${uuidv4()}`,
        patient_id: finalPatientId,
        payer_id: payerId,
        payer_name: payerName,
        member_id: args.member_id,
        group_number: args.group_number || null,
        plan_name: args.plan_name || null,
        is_primary: true
      };

      db.upsertPatientInsurance(insuranceRecord);
      storedInsurance = insuranceRecord;

      console.log(`✅ Insurance stored for patient: ${finalPatientId}`);

      // Keep canonical intake in sync (shared data format for web + voice)
      try {
        if (PatientIntakeService?.upsertIntakeByPatientId) {
          await PatientIntakeService.upsertIntakeByPatientId(finalPatientId, {
            insurance: {
              payer_name: payerName || '',
              payer_id: payerId || '',
              member_id: args.member_id || '',
              plan_name: args.plan_name || ''
            }
          });
        }
      } catch (_) {}
    } else if (patientPhone && !finalPatientId) {
      // Try to find patient by phone and link insurance
      try {
        const patient = db.getFHIRPatientByPhone(patientPhone);
        if (patient && payerId && payerName) {
          const { v4: uuidv4 } = require('uuid');
          const insuranceRecord = {
            id: `ins_${uuidv4()}`,
            patient_id: patient.resource_id,
            payer_id: payerId,
            payer_name: payerName,
            member_id: args.member_id,
            group_number: args.group_number || null,
            plan_name: args.plan_name || null,
            is_primary: true
          };

          db.upsertPatientInsurance(insuranceRecord);
          storedInsurance = insuranceRecord;

          console.log(`✅ Insurance stored for patient: ${patient.resource_id}`);

          // Keep canonical intake in sync (shared data format for web + voice)
          try {
            if (PatientIntakeService?.upsertIntakeByPatientId) {
              await PatientIntakeService.upsertIntakeByPatientId(patient.resource_id, {
                insurance: {
                  payer_name: payerName || '',
                  payer_id: payerId || '',
                  member_id: args.member_id || '',
                  plan_name: args.plan_name || ''
                }
              });
            }
          } catch (_) {}
        }
      } catch (patientError) {
        console.warn('⚠️  Could not link insurance to patient:', patientError.message);
      }
    }

    // Build response with eligibility data if available
    const response = {
      success: true,
      confirmed: true,
      payer_id: payerId,
      payer_name: payerName,
      member_id: args.member_id,
      message: `Insurance confirmed: ${payerName}`,
      stored: !!storedInsurance,
      insurance_id: storedInsurance?.id || null,
      patient_id: finalPatientId || (storedInsurance ? storedInsurance.patient_id : null), // Include patient_id in response
      apiCallSaved: validationResult?.apiCallSaved !== false
    };

    // Add eligibility/coverage information if available
    if (eligibilityResult && eligibilityResult.success) {
      response.coverage = {
        eligible: eligibilityResult.eligible || false,
        copay_amount: eligibilityResult.copay || eligibilityResult.copay_amount || 0,
        allowed_amount: eligibilityResult.allowedAmount || eligibilityResult.allowed_amount || 0,
        insurance_pays: eligibilityResult.insurancePays || eligibilityResult.insurance_pays || 0,
        deductible_total: eligibilityResult.deductibleTotal !== undefined ? eligibilityResult.deductibleTotal : (eligibilityResult.deductible_total || null),
        deductible_remaining: eligibilityResult.deductibleRemaining !== undefined ? eligibilityResult.deductibleRemaining : (eligibilityResult.deductible_remaining || null),
        coinsurance_percent: eligibilityResult.coinsurancePercent !== undefined ? eligibilityResult.coinsurancePercent : (eligibilityResult.coinsurance_percent || 0),
        plan_summary: eligibilityResult.planSummary || eligibilityResult.plan_summary || 'Plan details available'
      };

      // Calculate patient responsibility
      if (response.coverage.allowed_amount > 0) {
        const patientResponsibility = response.coverage.allowed_amount - (response.coverage.insurance_pays || 0);
        response.coverage.patient_responsibility = Math.max(0, patientResponsibility);
      }
    }

    return res.json(response);

  } catch (error) {
    console.error('❌ Error collecting insurance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/voice/insurance/check-eligibility', async (req, res) => {
  try {
    console.log('\n🏥 VOICE: Check Insurance Eligibility');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;

    const resolverEnabled = isPayorCanonicalResolverEnabled();
    const resolverShadow = isPayorCanonicalResolverShadowEnabled();
    const hasResolvablePayerInput = !!(args.payer_id || args.payer_name);

    // Required fields
    if (!args.member_id || !hasResolvablePayerInput) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: member_id and one of payer_id or payer_name'
      });
    }

    let resolverOutcome = null;
    if (resolverEnabled || resolverShadow) {
      try {
        resolverOutcome = resolveRuntimePayor(args);
      } catch (e) {
        console.warn('⚠️  Runtime payor resolver failed in eligibility path:', e.message);
      }
    }
    if (resolverShadow && resolverOutcome) {
      console.log('[payor-resolver:shadow][eligibility]', {
        resolved: resolverOutcome.resolved,
        source: resolverOutcome.resolution_source,
        entity_id: resolverOutcome?.canonical_entity?.id || null,
        routed_payer_id: resolverOutcome?.routing?.payer_id || null
      });
    }
    if (resolverEnabled) {
      if (resolverOutcome?.resolved) {
        args.payer_id = resolverOutcome.routing.payer_id || args.payer_id;
      } else if (!args.payer_id) {
        // Safe degraded fallback: return manual review requirement when no canonical mapping exists.
        return res.status(409).json({
          success: false,
          manual_review: true,
          error: 'No canonical payor match found for eligibility request',
          resolver: { enabled: true, resolved: false }
        });
      }
    }

    const networkPrecheckEnabled = isProviderNetworkPrecheckEnabled();
    const networkPrecheckShadow = isProviderNetworkPrecheckShadowEnabled();
    let networkPrecheck = null;
    if (networkPrecheckEnabled || networkPrecheckShadow) {
      try {
        networkPrecheck = resolveProviderPayorNetworkPrecheck({ args, resolverOutcome });
      } catch (e) {
        console.warn('⚠️  Provider network precheck failed in eligibility path:', e.message);
      }
    }

    // Get patient info if patient_id is provided
    let patientName = args.patient_name;
    let dateOfBirth = args.date_of_birth;
    let patientId = args.patient_id;

    if (args.patient_id) {
      // Try to get patient from FHIR patients table
      const patient = db.getFHIRPatient ? db.getFHIRPatient(args.patient_id) : null;
      if (patient) {
        try {
          const patientData = typeof patient.resource_data === 'string' ? JSON.parse(patient.resource_data) : patient.resource_data;
          patientName = patientName || patientData.name?.[0]?.text ||
            (patientData.name?.[0]?.given?.join(' ') + ' ' + patientData.name?.[0]?.family);
          dateOfBirth = dateOfBirth || patientData.birthDate;
          patientId = patient.resource_id;
        } catch (parseError) {
          console.warn('⚠️  Could not parse patient data:', parseError.message);
        }
      }
    }

    // Get appointment info if appointment_id is provided
    // W3-S4.6: Use resolved CPT from appointment.primary_cpt (triage) or getCptCodeForVisit
    let serviceCode = args.service_code;
    let dateOfService = args.date_of_service;

    if (args.appointment_id) {
      const appointment = await db.getAppointment(args.appointment_id);
      if (appointment) {
        serviceCode = serviceCode || appointment.primary_cpt || null;
        if (!serviceCode) {
          const apptType = appointment.appointment_type || '';
          const specialtyNames = ['Psychiatry', 'Cardiology', 'Pulmonology', 'Gastroenterology', 'Endocrinology', 'InfectiousDisease', 'Orthopedics', 'Neurology', 'Dermatology', 'PrimaryCare', 'ENT', 'Ophthalmology', 'Urology', 'EmergencyMedicine', 'ObstetricsGynecology', 'Pediatrics', 'Oncology'];
          if (specialtyNames.includes(apptType)) {
            try {
              const { getCptCodeForVisit } = require('./utils/cpt-helper');
              serviceCode = getCptCodeForVisit({ specialty: apptType, isNewPatient: true, urgency: 'routine' });
            } catch (_) {}
          }
          if (!serviceCode) {
            serviceCode = InsuranceService.mapAppointmentTypeToCPT(appointment.appointment_type, { urgency: 'routine' });
          }
        }
        dateOfService = dateOfService || appointment.date;
        patientId = patientId || appointment.patient_id;
      }
    }

    const eligibilityData = {
      patientId: patientId,
      patientName: patientName || 'Patient',
      dateOfBirth: dateOfBirth || '1990-01-01', // Default if not provided
      memberId: args.member_id,
      payerId: args.payer_id,
      serviceCode: serviceCode || (() => { try { const h = require('./utils/cpt-helper'); return h.getCptCodeForVisit({ specialty: 'PrimaryCare', urgency: 'routine', isNewPatient: true }); } catch (_) { return '99203'; } })(),
      dateOfService: dateOfService || new Date().toISOString().split('T')[0]
    };

    const result = await InsuranceService.checkEligibility(eligibilityData);

    if (resolverEnabled || resolverShadow) {
      result.payor_resolution = {
        enabled: resolverEnabled,
        shadow: resolverShadow,
        resolved: Boolean(resolverOutcome?.resolved),
        source: resolverOutcome?.resolution_source || 'none',
        canonical_entity_id: resolverOutcome?.canonical_entity?.id || null,
        canonical_name: resolverOutcome?.canonical_entity?.canonical_name || null,
        routed_payer_id: resolverOutcome?.routing?.payer_id || args.payer_id || null
      };
    }
    if (networkPrecheckEnabled || networkPrecheckShadow) {
      result.provider_network_precheck = {
        enabled: networkPrecheckEnabled,
        shadow: networkPrecheckShadow,
        decision: networkPrecheck?.decision || 'unknown',
        reason: networkPrecheck?.reason || 'precheck_unavailable',
        trace: networkPrecheck?.trace || {}
      };
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Error checking eligibility:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/voice/insurance/submit-claim', async (req, res) => {
  try {
    console.log('\n📋 VOICE: Submit Insurance Claim');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;

    const resolverEnabled = isPayorCanonicalResolverEnabled();
    const resolverShadow = isPayorCanonicalResolverShadowEnabled();
    const hasResolvablePayerInput = !!(args.payer_id || args.payer_name);

    // Required fields
    if (!args.appointment_id || !args.member_id || !hasResolvablePayerInput || !args.total_amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: appointment_id, member_id, total_amount, and one of payer_id or payer_name'
      });
    }

    let resolverOutcome = null;
    if (resolverEnabled || resolverShadow) {
      try {
        resolverOutcome = resolveRuntimePayor(args);
      } catch (e) {
        console.warn('⚠️  Runtime payor resolver failed in claim path:', e.message);
      }
    }
    if (resolverShadow && resolverOutcome) {
      console.log('[payor-resolver:shadow][submit-claim]', {
        resolved: resolverOutcome.resolved,
        source: resolverOutcome.resolution_source,
        entity_id: resolverOutcome?.canonical_entity?.id || null,
        routed_payer_id: resolverOutcome?.routing?.payer_id || null
      });
    }
    if (resolverEnabled) {
      if (resolverOutcome?.resolved) {
        args.payer_id = resolverOutcome.routing.payer_id || args.payer_id;
      } else if (!args.payer_id) {
        return res.status(409).json({
          success: false,
          manual_review: true,
          error: 'No canonical payor match found for claim submission',
          resolver: { enabled: true, resolved: false }
        });
      }
    }
    const networkPrecheckEnabled = isProviderNetworkPrecheckEnabled();
    const networkPrecheckShadow = isProviderNetworkPrecheckShadowEnabled();
    let networkPrecheck = null;
    if (networkPrecheckEnabled || networkPrecheckShadow) {
      try {
        networkPrecheck = resolveProviderPayorNetworkPrecheck({ args, resolverOutcome });
      } catch (e) {
        console.warn('⚠️  Provider network precheck failed in claim path:', e.message);
      }
    }

    // Get appointment details
    const appointment = await db.getAppointment(args.appointment_id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }

    // Get patient info
    let patientName = args.patient_name;
    let dateOfBirth = args.date_of_birth;
    let patientId = appointment.patient_id;

    if (appointment.patient_id) {
      // Try to get patient from FHIR patients table
      const patient = db.getFHIRPatient ? db.getFHIRPatient(appointment.patient_id) : null;
      if (patient) {
        try {
          const patientData = typeof patient.resource_data === 'string' ? JSON.parse(patient.resource_data) : patient.resource_data;
          patientName = patientName || patientData.name?.[0]?.text ||
            (patientData.name?.[0]?.given?.join(' ') + ' ' + patientData.name?.[0]?.family);
          dateOfBirth = dateOfBirth || patientData.birthDate;
          patientId = patient.resource_id;
        } catch (parseError) {
          console.warn('⚠️  Could not parse patient data:', parseError.message);
        }
      }
    }

    const idempotencyKey = args.idempotency_key || req.headers['idempotency-key'] ||
      `claim_${args.appointment_id}_${args.member_id}_${args.service_code || 'default'}_${args.date_of_service || appointment.date}`;

    const claimOpType = 'claim_submit';
    const cached = db.getIdempotentResult && db.getIdempotentResult(idempotencyKey, claimOpType);
    if (cached) {
      return res.json({ ...cached.result, idempotent: true });
    }
    const reserve = db.reserveIdempotencyKey && db.reserveIdempotencyKey(idempotencyKey, claimOpType);
    if (reserve === 'in_progress') {
      return res.status(409).json({ success: false, error: 'Claim submission in progress', idempotent: true });
    }
    if (reserve === 'completed') {
      const c2 = db.getIdempotentResult(idempotencyKey, claimOpType);
      if (c2) return res.json({ ...c2.result, idempotent: true });
    }

    // W3-S4.2/W3-S4.5: Use resolved CPT/ICD from triage (appointment.primary_cpt, primary_icd10)
    const resolvedCpt = args.service_code || appointment.primary_cpt || InsuranceService.mapAppointmentTypeToCPT(appointment.appointment_type, { urgency: 'routine' });
    const resolvedIcd = args.diagnosis_code || appointment.primary_icd10 || InsuranceService.mapAppointmentTypeToICD10(appointment.appointment_type);

    const billingEnvelope = require('../services/billing-claim-envelope-service');
    const placeOfService = billingEnvelope.resolvePlaceOfService({
      visit_mode: appointment.visit_mode,
      place_of_service: appointment.place_of_service || args.place_of_service
    });
    const modifiers = billingEnvelope.resolveTelehealthModifiers({
      place_of_service: placeOfService,
      visit_mode: appointment.visit_mode,
      payer_id: args.payer_id,
      existing_modifiers: billingEnvelope.parseCptModifiersJson(appointment.cpt_modifiers)
    });

    const claimData = {
      appointmentId: args.appointment_id,
      patientId: patientId,
      patientName: patientName || appointment.patient_name,
      dateOfBirth: dateOfBirth || '1990-01-01',
      memberId: args.member_id,
      payerId: args.payer_id,
      serviceCode: resolvedCpt,
      diagnosisCode: resolvedIcd,
      placeOfService,
      visit_mode: appointment.visit_mode,
      modifiers,
      totalAmount: parseFloat(args.total_amount),
      copayPaid: parseFloat(args.copay_paid || 0),
      dateOfService: args.date_of_service || appointment.date,
      blockchainProof: args.blockchain_proof || null,
      providerId: args.provider_id || null,
      npi: args.npi || null,
      idempotency_key: idempotencyKey
    };

    const result = await InsuranceService.submitClaim(claimData);

    if (resolverEnabled || resolverShadow) {
      result.payor_resolution = {
        enabled: resolverEnabled,
        shadow: resolverShadow,
        resolved: Boolean(resolverOutcome?.resolved),
        source: resolverOutcome?.resolution_source || 'none',
        canonical_entity_id: resolverOutcome?.canonical_entity?.id || null,
        canonical_name: resolverOutcome?.canonical_entity?.canonical_name || null,
        routed_payer_id: resolverOutcome?.routing?.payer_id || args.payer_id || null
      };
    }
    if (networkPrecheckEnabled || networkPrecheckShadow) {
      result.provider_network_precheck = {
        enabled: networkPrecheckEnabled,
        shadow: networkPrecheckShadow,
        decision: networkPrecheck?.decision || 'unknown',
        reason: networkPrecheck?.reason || 'precheck_unavailable',
        trace: networkPrecheck?.trace || {}
      };
    }

    if (result.success && db.completeIdempotentResult) {
      db.completeIdempotentResult(idempotencyKey, claimOpType, result);
    } else if (!result.success && db.releaseIdempotencyKey) {
      db.releaseIdempotencyKey(idempotencyKey, claimOpType);
    }

    // Send insurance billing email if claim was submitted successfully
    if (result.success && result.claimId) {
      try {
        const EmailService = require('./services/email-service');
        const insurerEmail = args.insurer_email || process.env.INSURER_BILLING_EMAIL || 'gigtogigdev@gmail.com';

        await EmailService.sendInsuranceBillingEmail(insurerEmail, {
          claimId: result.claimId,
          x12ClaimId: result.x12ClaimId,
          memberId: args.member_id,
          patientName: patientName || appointment.patient_name,
          serviceCode: args.service_code,
          totalAmount: parseFloat(args.total_amount),
          copayPaid: parseFloat(args.copay_paid || 0),
          dateOfService: args.date_of_service || appointment.date
        });

        console.log(`📧 Insurance billing email sent to: ${insurerEmail}`);
      } catch (emailError) {
        console.warn('⚠️  Failed to send insurance billing email:', emailError.message);
        // Don't fail the claim submission if email fails
      }
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Error submitting claim:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/voice/insurance/check-claim-status', async (req, res) => {
  try {
    console.log('\n🔍 VOICE: Check Claim Status');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;

    if (!args.claim_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: claim_id'
      });
    }

    const result = await InsuranceService.checkClaimStatus(args.claim_id);

    res.json(result);
  } catch (error) {
    console.error('❌ Error checking claim status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
}

module.exports = { registerVoiceAppointmentRoutes };
