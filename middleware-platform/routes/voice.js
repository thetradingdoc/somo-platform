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

const router = express.Router();

/**
 * Product Search for Voice Agents
 * POST /voice/products/search
 */
router.post('/products/search', async (req, res) => {
    console.log('\n📦 VOICE: Product Search');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 REQUEST BODY:', JSON.stringify(req.body, null, 2));
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

        // Try to get merchant - if not found, try fallback methods
        let merchant = merchant_id ? db.getMerchant(merchant_id) : null;

        // FALLBACK: If merchant not found, try to determine from call context
        if (!merchant) {
            console.log('⚠️  Merchant not found by ID, trying fallback methods...');
            
            // Method 1: Try to find merchant by subdomain (akin-dunbar)
            const fallbackMerchant = db.getMerchantBySubdomain('akin-dunbar');
            if (fallbackMerchant) {
                console.log('✅ Found merchant by subdomain (akin-dunbar):', fallbackMerchant.id);
                merchant = fallbackMerchant;
                merchant_id = merchant.id;
            } else {
                // Method 2: Try to get first active merchant (last resort)
                const allMerchants = db.getAllMerchants();
                if (allMerchants && allMerchants.length > 0) {
                    // Prefer merchants with subdomain 'akin-dunbar' or first active one
                    const preferredMerchant = allMerchants.find(m => m.subdomain === 'akin-dunbar') || allMerchants[0];
                    console.log('⚠️  Using fallback merchant:', preferredMerchant.id, preferredMerchant.name);
                    merchant = preferredMerchant;
                    merchant_id = merchant.id;
                }
            }
        }

        // Final validation
        if (!merchant) {
            console.log('❌ ERROR: Could not determine merchant');
            return res.status(404).json({
                success: false,
                error: 'Merchant not found. Please ensure merchant is configured in the system.'
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
        console.log('📥 Request body:', JSON.stringify(req.body, null, 2));

        // Extract email from request (multiple possible locations)
        const email = req.body.customer_email || req.body.args?.customer_email || req.body.customer?.email;
        
        // CRITICAL: Validate email is present
        if (!email) {
            console.error('❌ MISSING EMAIL IN CHECKOUT REQUEST');
            console.error('   Request body keys:', Object.keys(req.body));
            console.error('   Request body:', JSON.stringify(req.body, null, 2));
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

        // Use orchestrator to process payment
        const result = await PaymentOrchestrator.createCheckout(standardRequest);
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
                checkout
            });
        }

        // Complete checkout (same logic as webhook handler)
        // Get merchant - with fallback logic for invalid merchant_id
        let merchant = db.getMerchant(checkout.merchant_id);
        
        if (!merchant) {
            const fallbackMerchant = db.getMerchantBySubdomain('akin-dunbar');
            merchant = fallbackMerchant || db.getAllMerchants()?.[0];
        }
        
        if (!merchant) {
            return res.status(404).json({
                success: false,
                error: 'Merchant not found. Please ensure merchant is configured in the system.'
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
                source: 'voice'
            });
            merchantOrder = { id: orderId };
        }
        
        // Update checkout status
        await db.updateVoiceCheckout(checkout_id, {
            status: 'completed',
            payment_intent_id,
            merchant_order_id: merchantOrder.id,
            completed_at: new Date().toISOString()
        });
        
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