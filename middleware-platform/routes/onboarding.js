/**
 * ONBOARDING ROUTES
 * Handles product setup and initial configuration for new customers
 */

const express = require('express');
const db = require('../database');
const { requireCustomerAuth, requireMerchant } = require('../middleware/customer-auth');
const { v4: uuidv4 } = require('uuid');
const rateLimiter = require('../middleware/rate-limiter').authLimiter;

const router = express.Router();

/**
 * POST /api/onboarding/setup-products
 * Bulk create products for customer's merchant during onboarding
 * 
 * Expected payload:
 * {
 *   "products": [
 *     {
 *       "name": "Product Name",
 *       "description": "Product description",
 *       "price": 29.99,
 *       "inventory": 100,
 *       "image_url": "https://...",
 *       "category": "Category Name"
 *     },
 *     ...
 *   ]
 * }
 */
router.post('/setup-products', rateLimiter, requireCustomerAuth, requireMerchant, async (req, res) => {
    try {
        const { products } = req.body;

        if (!products || !Array.isArray(products) || products.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Products array is required',
                message: 'Please provide an array of products to create'
            });
        }

        // Validate each product
        const errors = [];
        const validProducts = [];

        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            const productErrors = [];

            if (!product.name || typeof product.name !== 'string' || product.name.trim().length === 0) {
                productErrors.push('name is required and must be a non-empty string');
            }

            if (product.price === undefined || product.price === null) {
                productErrors.push('price is required');
            } else if (typeof product.price !== 'number' || product.price < 0) {
                productErrors.push('price must be a non-negative number');
            }

            if (product.inventory !== undefined && (typeof product.inventory !== 'number' || product.inventory < 0)) {
                productErrors.push('inventory must be a non-negative number');
            }

            if (productErrors.length > 0) {
                errors.push({
                    index: i,
                    product: product.name || `Product ${i + 1}`,
                    errors: productErrors
                });
            } else {
                validProducts.push(product);
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                message: 'Some products have validation errors',
                errors: errors,
                valid_count: validProducts.length,
                invalid_count: errors.length
            });
        }

        // Get merchant_id from authenticated customer
        const merchant_id = req.merchant_id;

        // Create products
        const createdProducts = [];
        const failedProducts = [];

        for (const product of validProducts) {
            try {
                const result = db.createProduct({
                    name: product.name.trim(),
                    description: product.description || null,
                    price: product.price,
                    inventory: product.inventory !== undefined ? product.inventory : 0,
                    image_url: product.image_url || null,
                    category: product.category || null,
                    merchant_id: merchant_id // Always use from auth
                });

                const createdProduct = db.getProduct(result.lastInsertRowid.toString());
                createdProducts.push(createdProduct);
            } catch (error) {
                console.error(`❌ Failed to create product "${product.name}":`, error);
                failedProducts.push({
                    product: product.name,
                    error: error.message
                });
            }
        }

        // Return results
        if (failedProducts.length > 0 && createdProducts.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'Failed to create products',
                message: 'All products failed to create',
                failed: failedProducts
            });
        }

        res.json({
            success: true,
            message: `Successfully created ${createdProducts.length} product(s)`,
            created: createdProducts,
            created_count: createdProducts.length,
            failed: failedProducts.length > 0 ? failedProducts : undefined,
            failed_count: failedProducts.length
        });

    } catch (error) {
        console.error('❌ Onboarding product setup error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to setup products',
            message: error.message
        });
    }
});

/**
 * GET /api/onboarding/status
 * Get onboarding status for authenticated customer
 */
router.get('/status', rateLimiter, requireCustomerAuth, (req, res) => {
    try {
        const customer = req.customer;
        const merchant_id = customer.merchant_id;

        // Check if merchant exists
        const merchant = merchant_id ? db.getMerchant(merchant_id) : null;

        // Count products
        const productCount = merchant_id ? db.getProductsByMerchant(merchant_id).length : 0;

        // Check onboarding completion
        const hasMerchant = !!merchant;
        const hasProducts = productCount > 0;
        const hasRetellAgent = !!customer.retell_agent_id;
        const hasTwilioPhone = !!customer.twilio_phone_number;
        const hasPaymentMethod = !!customer.stripe_payment_method_id && customer.card_verified === 1;

        const onboardingComplete = hasMerchant && hasProducts && hasRetellAgent && hasPaymentMethod;

        res.json({
            success: true,
            onboarding: {
                complete: onboardingComplete,
                merchant: {
                    exists: hasMerchant,
                    id: merchant_id,
                    name: merchant?.name || null
                },
                products: {
                    count: productCount,
                    has_products: hasProducts
                },
                voice_agent: {
                    configured: hasRetellAgent,
                    agent_id: customer.retell_agent_id || null,
                    status: customer.retell_agent_status || null
                },
                phone: {
                    configured: hasTwilioPhone,
                    number: customer.twilio_phone_number || null
                },
                payment: {
                    configured: hasPaymentMethod,
                    verified: customer.card_verified === 1
                }
            },
            next_steps: onboardingComplete ? [] : [
                !hasMerchant && 'Create merchant account',
                !hasProducts && 'Add products',
                !hasRetellAgent && 'Configure voice agent',
                !hasPaymentMethod && 'Verify payment method'
            ].filter(Boolean)
        });
    } catch (error) {
        console.error('❌ Onboarding status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get onboarding status',
            message: error.message
        });
    }
});

module.exports = router;

