/**
 * Customer Service
 * Handles customer creation and lookup from checkout data
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../database');

class CustomerService {
    /**
     * Get or create customer from checkout data
     * Used during voice checkout to ensure customer record exists
     * @param {Object} checkout - Checkout data with customer info
     * @param {string} merchantId - Merchant ID (optional, will use checkout.merchant_id if not provided)
     * @returns {Object} Customer record
     */
    static getOrCreateCustomerFromCheckout(checkout, merchantId = null) {
        if (!checkout) {
            throw new Error('Checkout data is required');
        }

        // Try to find existing customer by phone or email
        let customer = null;

        if (checkout.customer_phone) {
            customer = db.getCustomerByPhone(checkout.customer_phone);
        }

        if (!customer && checkout.customer_email) {
            customer = db.getCustomerByEmail(checkout.customer_email);
        }

        // If customer exists, update merchant_id if needed
        if (customer) {
            const finalMerchantId = merchantId || checkout.merchant_id || customer.merchant_id;
            if (finalMerchantId && customer.merchant_id !== finalMerchantId) {
                db.updateCustomer(customer.id, { merchant_id: finalMerchantId });
                customer.merchant_id = finalMerchantId;
            }

            // Update phone/email if missing
            const updates = {};
            if (!customer.phone_number && checkout.customer_phone) {
                updates.phone_number = checkout.customer_phone;
            }
            if (!customer.email && checkout.customer_email) {
                updates.email = checkout.customer_email;
            }
            if (!customer.name && checkout.customer_name) {
                updates.name = checkout.customer_name;
            }

            if (Object.keys(updates).length > 0) {
                db.updateCustomer(customer.id, updates);
                // Refresh customer object
                customer = db.getCustomer(customer.id);
            }

            return customer;
        }

        // Create new customer if not found
        const customerId = uuidv4();
        const finalMerchantId = merchantId || checkout.merchant_id || null;

        const newCustomer = {
            id: customerId,
            name: checkout.customer_name || 'Customer',
            email: checkout.customer_email || `customer-${customerId}@example.com`,
            phone_number: checkout.customer_phone || null,
            merchant_id: finalMerchantId,
            email_verified: false,
            status: 'active',
            customer_type: 'ecommerce' // Cannabis e-commerce customer
        };

        try {
            db.createCustomer(newCustomer);
            console.log(`✅ Created customer ${customerId} from checkout ${checkout.id || 'unknown'}`);
            const createdCustomer = db.getCustomer(customerId);
            
            // Trigger automation rules for customer_created
            if (createdCustomer && finalMerchantId) {
                try {
                    const AutomationService = require('./automation-service');
                    AutomationService.checkAndExecuteRules('customer_created', {
                        merchant_id: finalMerchantId,
                        customer_id: createdCustomer.id,
                        customer: createdCustomer
                    }).catch(err => {
                        console.warn('⚠️  Automation trigger error (non-fatal):', err.message);
                    });
                } catch (automationError) {
                    console.warn('⚠️  Automation trigger error (non-fatal):', automationError.message);
                }
            }
            
            return createdCustomer;
        } catch (error) {
            console.error('❌ Error creating customer from checkout:', error);
            // If creation fails (e.g., duplicate email), try to find existing customer
            if (checkout.customer_email) {
                const existing = db.getCustomerByEmail(checkout.customer_email);
                if (existing) {
                    console.log(`⚠️  Customer already exists with email ${checkout.customer_email}, using existing`);
                    return existing;
                }
            }
            throw error;
        }
    }
}

module.exports = CustomerService;

