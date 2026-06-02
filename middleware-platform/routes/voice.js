/**
 * VOICE ROUTES (REFACTORED)
 * 
 * Now uses Payment Orchestrator for checkout logic
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const db = require('../database');
const VoiceAdapter = require('../adapters/voice-adapter');
const PaymentOrchestrator = require('../services/payment-orchestrator');
const EmailVerificationService = require('../services/email-verification-service');
const constants = require('../utils/constants');
const { tenantContext } = require('../middleware/tenant-context');

const router = express.Router();

/**
 * Product Search for Voice Agents
 * POST /voice/products/search
 */
router.post('/products/search', async (req, res) => {
    console.log('\n📦 VOICE: Product Search');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const { safeLogRequestBody } = require('../services/payment-security');
    safeLogRequestBody('REQUEST BODY:', req);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
        // Handle both direct format and Retell's nested format
        let merchant_id, query;
        let callData = null;

        if (req.body.args) {
            // Retell format: data is in req.body.args
            merchant_id = req.body.args.merchant_id;
            query = req.body.args.query;
            callData = req.body.call; // Retell includes call context
            console.log('✅ Detected Retell format (nested args)');
        } else {
            // Direct format: data is in req.body
            merchant_id = req.body.merchant_id;
            query = req.body.query;
            callData = req.body.call;
            console.log('✅ Detected direct format');
        }

        console.log('Merchant ID from args:', merchant_id);
        console.log('Query:', query || 'all products');

        // Try to get merchant - use tenant context if available, otherwise use provided merchant_id
        let merchant = null;

        // First, try to use tenant context from middleware (if available)
        if (req.tenant && req.tenant.validated) {
            if (req.tenant.merchant) {
                merchant = req.tenant.merchant;
                merchant_id = merchant.id;
                console.log('✅ Using merchant from tenant context:', merchant.name);
            } else if (req.tenant.clinic && req.tenant.clinic.merchant_id) {
                // Clinic has associated merchant
                merchant = db.getMerchant(req.tenant.clinic.merchant_id);
                if (merchant) {
                    merchant_id = merchant.id;
                    console.log('✅ Using merchant from clinic association:', merchant.name);
                }
            }
        }

        // If still no merchant, try provided merchant_id (but validate it exists)
        if (!merchant && merchant_id) {
            merchant = db.getMerchant(merchant_id);
            if (merchant) {
                console.log('✅ Using merchant from request:', merchant.name);
            } else {
                console.warn(`⚠️  REJECTED invalid merchant_id from request: ${merchant_id} (not found in database)`);
                console.warn(`   Ignoring invalid merchant_id and trying fallbacks...`);
                // Don't use invalid merchant_id - clear it and try fallbacks
                merchant_id = null;
            }
        }

        // Fallback: Try default tenant if no merchant found yet
        if (!merchant) {
            const constants = require('../utils/constants');
            const defaultSubdomain = constants.TENANTS.DEFAULT_SUBDOMAIN || 'akin-dunbar';
            const defaultMerchant = db.getMerchantBySubdomain(defaultSubdomain);
            if (defaultMerchant) {
                merchant = defaultMerchant;
                merchant_id = defaultMerchant.id;
                console.log(`✅ Using default tenant merchant (${defaultSubdomain}): ${merchant_id}`);
            }
        }

        // Final validation - return error instead of fallback (for security)
        if (!merchant) {
            console.log('❌ ERROR: Could not determine merchant');
            console.log('   Provided merchant_id:', merchant_id);
            console.log('   Tenant context:', req.tenant ? (req.tenant.validated ? 'validated' : 'not validated') : 'not available');
            return res.status(404).json({
                success: false,
                error: 'Merchant not found. Please ensure merchant is configured in the system.',
                message: 'Could not determine merchant from request. Please provide merchant_id or ensure tenant context is available.'
            });
        }

        console.log('✅ Merchant found:', merchant.name);
        console.log('Fetching products from database for merchant:', merchant_id);

        // Fetch products directly from database (merged merchant-shop)
        let products;
        if (query) {
            products = db.searchProducts(query, merchant_id);
            console.log(`🔍 Found ${products.length} products matching "${query}"`);
        } else {
            products = db.getProductsByMerchant(merchant_id);
            console.log(`📦 Fetched ${products.length} products from database`);
        }

        // Debug: Log first product structure
        if (products.length > 0) {
            console.log('🔍 Sample product from DB:');
            console.log('   Type:', typeof products[0]);
            console.log('   Keys:', Object.keys(products[0]));
            console.log('   Has name?', 'name' in products[0]);
            console.log('   name value:', products[0].name);
            console.log('   name type:', typeof products[0].name);
            console.log('   Full JSON:', JSON.stringify(products[0], null, 2));
        }

        // Convert to voice-friendly format
        const voiceProducts = VoiceAdapter.toVoiceFormat(products);

        // Debug: Log first voice product
        if (voiceProducts.length > 0) {
            console.log('🔍 Sample voice product after transformation:');
            console.log('   Keys:', Object.keys(voiceProducts[0]));
            console.log('   name:', voiceProducts[0].name);
            console.log('   Full JSON:', JSON.stringify(voiceProducts[0], null, 2));
        }

        console.log('✅ Returning', voiceProducts.length, 'products');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        res.json({
            success: true,
            merchant_id,
            merchant_name: merchant.name,
            query: query || 'all products',
            product_count: voiceProducts.length,
            products: voiceProducts
        });

    } catch (error) {
        console.error('❌ Voice product search error:', error.message);
        console.error('Stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get Single Product Details
 * GET /voice/products/:product_id
 */
router.get('/products/:product_id', async (req, res) => {
    try {
        const { product_id } = req.params;
        const { merchant_id } = req.query;

        if (!merchant_id) {
            return res.status(400).json({
                success: false,
                error: 'merchant_id required'
            });
        }

        const merchant = db.getMerchant(merchant_id);
        if (!merchant) {
            return res.status(404).json({
                success: false,
                error: 'Merchant not found'
            });
        }

        const response = await axios.get(`${merchant.api_url}/api/products/${product_id}`);
        const product = response.data.product;

        if (!product) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        const voiceProduct = VoiceAdapter.toVoiceFormat([product])[0];

        res.json({
            success: true,
            product: voiceProduct
        });

    } catch (error) {
        console.error('Voice product details error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Send Email Verification Code
 * POST /voice/verify/send-code
 */
router.post('/verify/send-code', async (req, res) => {
    try {
        console.log('\n📧 VOICE: Sending Email Verification Code');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        const { email, customer_id, customer_name } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email address is required'
            });
        }

        const result = await EmailVerificationService.sendVerificationCode(
            email,
            customer_id,
            customer_name
        );

        if (!result.success) {
            return res.status(400).json(result);
        }

        // Don't send code in response for security (only for testing)
        const response = {
            success: true,
            message: 'Verification code sent to email',
            expires_at: result.expires_at,
            // Include code only in development for testing
            ...(process.env.NODE_ENV !== 'production' && { code: result.code })
        };

        res.json(response);

    } catch (error) {
        console.error('❌ Send verification code error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Verify Email Code
 * POST /voice/verify/verify-code
 */
router.post('/verify/verify-code', async (req, res) => {
    try {
        console.log('\n✅ VOICE: Verifying Email Code');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        const { email, code } = req.body;

        if (!email || !code) {
            return res.status(400).json({
                success: false,
                error: 'Email and verification code are required'
            });
        }

        const result = await EmailVerificationService.verifyCode(email, code);

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);

    } catch (error) {
        console.error('❌ Verify code error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Check Verification Status
 * GET /voice/verify/status/:email
 */
router.get('/verify/status/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const status = EmailVerificationService.getVerificationStatus(email);
        res.json(status);
    } catch (error) {
        console.error('❌ Verification status error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Create Checkout Session
 * POST /voice/checkout/create
 * 
 * NOW REQUIRES EMAIL VERIFICATION!
 */
router.post('/checkout/create', async (req, res) => {
    try {
        console.log('\n💳 VOICE: Creating Checkout via Orchestrator');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const { safeLogRequestBody } = require('../services/payment-security');
        safeLogRequestBody('Request body:', req);

        // Extract email from request (multiple possible locations)
        let email = req.body.customer_email || req.body.args?.customer_email || req.body.customer?.email;

        // Extract phone number for lookup
        const phone = req.body.customer_phone || req.body.args?.customer_phone || req.body.customer?.phone ||
            req.body.call?.from_number || req.body.call?.custom_sip_headers?.['x-twilio-callsid'];

        // If email is missing, try to look it up from phone number
        if (!email && phone) {
            console.log(`🔍 Email missing, looking up from phone: ${phone}`);

            // Normalize phone number
            const SMSService = require('../services/sms-service');
            const normalizedPhone = SMSService.formatPhoneNumber(phone);

            // Try to find FHIR patient by phone (primary lookup)
            const patient = db.getFHIRPatientByPhone(normalizedPhone);
            if (patient) {
                const patientData = typeof patient.resource_data === 'string'
                    ? JSON.parse(patient.resource_data)
                    : patient.resource_data;
                const emailContact = patientData.telecom?.find(t => t.system === 'email');
                if (emailContact && emailContact.value) {
                    email = emailContact.value;
                    console.log(`✅ Found email from FHIR patient: ${email}`);
                } else if (patient.email) {
                    // Check direct email field
                    email = patient.email;
                    console.log(`✅ Found email from FHIR patient (direct field): ${email}`);
                }
            }

            // If still no email, try customers table (for API customers)
            if (!email) {
                const customer = db.getCustomerByPhone(normalizedPhone);
                if (customer && customer.email) {
                    email = customer.email;
                    console.log(`✅ Found email from customers table: ${email}`);
                }
            }

            // If still no email, generate a placeholder (will need verification)
            if (!email) {
                // Generate placeholder email from phone for voice-only customers
                const phoneDigits = normalizedPhone.replace(/\D/g, '');
                email = `voice-${phoneDigits}@voice.callsomo.com`;
                console.log(`⚠️  No email found, using placeholder: ${email}`);
                console.log(`   Customer will need to verify this email before checkout`);
            }
        }

        // CRITICAL: Validate email is present
        if (!email) {
            console.error('❌ MISSING EMAIL IN CHECKOUT REQUEST');
            const { safeLogRequestBody } = require('../services/payment-security');
            safeLogRequestBody('Request body (error):', req);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            return res.status(400).json({
                success: false,
                error: 'Email address is required to create checkout',
                requires_email: true,
                message: 'Please provide your email address to complete the checkout.'
            });
        }

        // Check if email verification is required and verified
        console.log(`\n🔍 CHECKING EMAIL VERIFICATION FOR CHECKOUT`);
        console.log(`   Email: ${email}`);
        const isVerified = EmailVerificationService.isEmailVerified(email);
        console.log(`   Is Verified: ${isVerified}`);

        if (!isVerified) {
            console.log('⚠️  Email not verified, requiring verification');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            return res.status(403).json({
                success: false,
                error: 'Email verification required',
                requires_verification: true,
                email: email,
                message: 'Please verify your email before proceeding with checkout. Use /voice/verify/send-code to get a verification code.'
            });
        }
        console.log('✅ Email verified, proceeding with checkout');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Convert to standard format
        const standardRequest = VoiceAdapter.toStandardPaymentRequest(req.body);
        console.log('📋 Standard request:', JSON.stringify(standardRequest, null, 2));

        // CRITICAL: Verify email survived adapter conversion
        if (!standardRequest.customer?.email) {
            console.error('❌ EMAIL LOST IN ADAPTER CONVERSION');
            console.error('   Original email:', email);
            console.error('   Standard request customer:', standardRequest.customer);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            return res.status(400).json({
                success: false,
                error: 'Email address is required to create checkout',
                requires_email: true,
                message: 'Please provide your email address to complete the checkout.'
            });
        }
        console.log(`✅ Email preserved in adapter: ${standardRequest.customer.email}`);

        // Use orchestrator to process payment (pass tenant context if available)
        const result = await PaymentOrchestrator.createCheckout(standardRequest, req.tenant);
        console.log('📤 Orchestrator result:', JSON.stringify({
            success: result.success,
            checkout_id: result.checkout_id,
            error: result.error,
            message: result.message
        }, null, 2));

        // Convert back to voice format
        const response = VoiceAdapter.fromStandardResponse(result);
        console.log('📤 Voice response:', JSON.stringify(response, null, 2));

        res.json(response);

    } catch (error) {
        console.error('❌ Voice checkout error:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get Checkout Status
 * GET /voice/checkout/status/:checkout_id
 */
router.get('/checkout/status/:checkout_id', async (req, res) => {
    try {
        const { checkout_id } = req.params;

        const result = await PaymentOrchestrator.getCheckoutStatus(checkout_id);

        if (!result.isSuccess()) {
            return res.status(404).json({
                success: false,
                error: result.error
            });
        }

        res.json({
            success: true,
            checkout_id: result.checkout_id,
            status: result.payment.status,
            amount: result.payment.amount,
            created_at: result.metadata.created_at,
            completed_at: result.metadata.completed_at
        });

    } catch (error) {
        console.error('Voice checkout status error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Complete Checkout (called after payment succeeds)
 * POST /voice/checkout/complete/:checkout_id
 */
router.post('/checkout/complete/:checkout_id', async (req, res) => {
    try {
        const { checkout_id } = req.params;
        const { payment_intent_id } = req.body;

        const checkout = await db.getVoiceCheckout(checkout_id);

        if (!checkout) {
            return res.status(404).json({
                success: false,
                error: 'Checkout not found'
            });
        }

        if (checkout.status === 'completed') {
            return res.json({
                success: true,
                message: 'Checkout already completed',
                order_id: checkout.merchant_order_id || null,
                checkout
            });
        }

        // Complete checkout (same logic as webhook handler)
        // Get merchant - use tenant context if available, otherwise use checkout.merchant_id
        let merchant = null;

        // First, try to use tenant context from middleware (if available)
        if (req.tenant && req.tenant.validated) {
            if (req.tenant.merchant) {
                merchant = req.tenant.merchant;
                console.log('✅ Using merchant from tenant context:', merchant.name);
            } else if (req.tenant.clinic && req.tenant.clinic.merchant_id) {
                merchant = db.getMerchant(req.tenant.clinic.merchant_id);
                if (merchant) {
                    console.log('✅ Using merchant from clinic association:', merchant.name);
                }
            }
        }

        // If still no merchant, try checkout.merchant_id
        if (!merchant && checkout.merchant_id) {
            merchant = db.getMerchant(checkout.merchant_id);
            if (merchant) {
                console.log('✅ Using merchant from checkout:', merchant.name);
            }
        }

        // Final validation - return error instead of fallback (for security)
        if (!merchant) {
            console.log('❌ ERROR: Could not determine merchant for checkout');
            console.log('   Checkout merchant_id:', checkout.merchant_id);
            console.log('   Tenant context:', req.tenant ? (req.tenant.validated ? 'validated' : 'not validated') : 'not available');
            return res.status(404).json({
                success: false,
                error: 'Merchant not found. Please ensure merchant is configured in the system.',
                message: 'Could not determine merchant from checkout or tenant context.'
            });
        }

        // CRITICAL: Decrement inventory BEFORE creating order
        if (checkout.product_id && checkout.quantity) {
            try {
                const product = db.getProduct(checkout.product_id);
                if (product && product.merchant_id === checkout.merchant_id && product.inventory >= checkout.quantity) {
                    db.updateInventory(checkout.product_id, checkout.quantity);
                }
            } catch (inventoryError) {
                console.error('❌ Error decrementing inventory:', inventoryError);
            }
        }

        // Create order - try external API first, fallback to internal
        const orderData = VoiceAdapter.toMerchantOrderFormat(checkout);
        let merchantOrder = null;

        if (merchant.api_url) {
            try {
                const orderResponse = await axios.post(`${merchant.api_url}/api/orders`, orderData, { timeout: 10000 });
                merchantOrder = orderResponse.data.order;
            } catch (apiError) {
                console.error('❌ Merchant API call failed:', apiError.message);
            }
        }

        if (!merchantOrder) {
            const orderId = uuidv4();
            // Extract shipping address for drop_point
            const shippingAddress = checkout.shipping_address || checkout.customer_address || null;
            const dropPoint = shippingAddress; // Drop point is the delivery address

            db.createOrder({
                id: orderId,
                merchant_id: checkout.merchant_id,
                product_id: checkout.product_id,
                quantity: checkout.quantity,
                customer_email: checkout.customer_email || 'guest@example.com',
                customer_name: checkout.customer_name,
                customer_phone: checkout.customer_phone,
                shipping_address: shippingAddress,
                pickup_address: checkout.pickup_address || null, // Pickup location if provided
                pickup_latitude: checkout.pickup_latitude || null,
                pickup_longitude: checkout.pickup_longitude || null,
                drop_point: dropPoint, // Delivery address
                total_amount: checkout.amount,
                status: 'paid',
                payment_status: 'paid',
                source: 'voice',
                voice_checkout_id: checkout_id,
                stripe_payment_intent_id: payment_intent_id || null
            });
            merchantOrder = { id: orderId };
        }

        // Create or get customer from checkout
        let customer = null;
        try {
            const CustomerService = require('../services/customer-service');
            customer = CustomerService.getOrCreateCustomerFromCheckout(checkout, merchant.id);
            console.log(`✅ Customer ${customer.id} ready for wallet creation`);
        } catch (customerError) {
            console.warn(`⚠️  Customer creation/lookup error (non-fatal):`, customerError.message);
        }

        // Update checkout status (include customer_id if available)
        await db.updateVoiceCheckout(checkout_id, {
            status: 'completed',
            payment_intent_id,
            merchant_order_id: merchantOrder.id,
            customer_id: customer?.id || null,
            completed_at: new Date().toISOString()
        });

        // Auto-create wallet for customer (preferred) or FHIR Patient (fallback)
        if (merchant.id) {
            try {
                const CircleService = require('../services/circle-service');

                // Priority 1: Create wallet for customer (cannabis e-commerce)
                if (customer && customer.id) {
                    const walletResult = await CircleService.getOrCreateCustomerWallet(customer.id, {
                        createIfNotExists: true,
                        merchantId: merchant.id
                    });
                    if (walletResult.success) {
                        console.log(`✅ Auto-created wallet for customer ${customer.id} during checkout completion`);
                        
                        // If payment_method is "wallet", create debit transaction
                        if (checkout.payment_method === 'wallet' && checkout.amount) {
                            try {
                                await db.createWalletTransaction({
                                    customer_id: customer.id,
                                    merchant_id: merchant.id,
                                    type: 'debit',
                                    amount: checkout.amount,
                                    currency: 'USDC',
                                    metadata: {
                                        source: 'checkout',
                                        checkout_id: checkout_id,
                                        order_id: merchantOrder.id,
                                        product_id: checkout.product_id
                                    }
                                });
                                console.log(`✅ Created wallet debit transaction for checkout ${checkout_id}`);
                            } catch (txError) {
                                console.warn(`⚠️  Wallet transaction creation error (non-fatal):`, txError.message);
                            }
                        }
                    } else {
                        console.warn(`⚠️  Customer wallet creation skipped: ${walletResult.error}`);
                    }
                }

                // Priority 2: Fallback to FHIR Patient wallet (if customer doesn't exist but FHIR Patient does)
                if (!customer && checkout.fhir_patient_id) {
                const walletResult = await CircleService.getOrCreatePatientWallet(checkout.fhir_patient_id, {
                    createIfNotExists: true,
                    merchantId: merchant.id
                });
                if (walletResult.success) {
                    console.log(`✅ Auto-created wallet for patient ${checkout.fhir_patient_id} during checkout completion`);
                    } else {
                        console.warn(`⚠️  Patient wallet creation skipped: ${walletResult.error}`);
                    }
                }
            } catch (walletError) {
                console.warn(`⚠️  Wallet creation error during checkout completion (non-fatal):`, walletError.message);
            }
        }

        // Create transaction record for admin tracking
        db.createTransaction({
            id: uuidv4(),
            merchant_id: checkout.merchant_id,
            platform: 'voice',
            platform_order_id: checkout_id,
            merchant_order_id: merchantOrder.id,
            product_id: checkout.product_id,
            amount: checkout.amount,
            status: 'completed',
            customer_email: checkout.customer_email || checkout.customer_phone,
            completed_at: new Date().toISOString()
        });

        // Trigger automation rules for order_completed
        if (customer && merchant.id) {
            try {
                const AutomationService = require('../services/automation-service');
                const order = db.getOrder(merchantOrder.id);
                await AutomationService.checkAndExecuteRules('order_completed', {
                    merchant_id: merchant.id,
                    customer_id: customer.id,
                    customer,
                    order: order || merchantOrder,
                    checkout
                });
            } catch (automationError) {
                console.warn('⚠️  Automation trigger error (non-fatal):', automationError.message);
            }
        }

        res.json({
            success: true,
            message: 'Checkout completed successfully',
            checkout_id,
            order: {
                id: merchantOrder.id,
                status: 'paid',
                amount: checkout.amount
            }
        });

    } catch (error) {
        console.error('Voice checkout completion error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get Order Tracking (for voice agent)
 * POST /voice/orders/tracking
 * 
 * Called by Retell when agent invokes get_order_tracking function
 */
router.post('/orders/tracking', async (req, res) => {
    console.log('\n📦 VOICE: Order Tracking Request');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
        const TrackingService = require('../services/tracking-service');

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

        // If not found by ID, search by customer email or phone
        if (!order && (customer_email || customer_phone)) {
            const allOrders = db.getAllOrders();
            order = allOrders.find(o => {
                const emailMatch = customer_email && o.customer_email &&
                    o.customer_email.toLowerCase() === customer_email.toLowerCase();
                const phoneMatch = customer_phone && o.customer_phone &&
                    o.customer_phone.replace(/\D/g, '') === customer_phone.replace(/\D/g, '');
                return emailMatch || phoneMatch;
            });

            // If multiple orders found, get the most recent one
            if (!order && allOrders.length > 0) {
                const matchingOrders = allOrders.filter(o => {
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

/**
 * Health check
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        service: 'voice-protocol',
        version: '1.0.0'
    });
});

module.exports = router;