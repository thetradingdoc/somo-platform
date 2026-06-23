/**
 * Promotion Commands Handler
 * Handles promotion-related commands: create, activate, deactivate, show, email
 */

const db = require('../../database');
const { v4: uuidv4 } = require('uuid');
const EmailService = require('../platform/email-service');

class PromotionCommands {
    /**
     * Parse promotion command
     */
    async parse(command, context) {
        const cmd = command.toLowerCase().trim();

        // Create promotion: "create promotion", "make promotion", "add promotion"
        if (cmd.match(/^(create|make|add)\s+(a\s+)?promotion/)) {
            return {
                matched: true,
                action: 'create',
                params: this._extractCreateParams(command)
            };
        }

        // Activate promotion: "activate promotion", "enable promotion", "start promotion"
        if (cmd.match(/^(activate|enable|start|turn\s+on)\s+(the\s+)?promotion/)) {
            return {
                matched: true,
                action: 'activate',
                params: this._extractPromotionName(command)
            };
        }

        // Deactivate promotion: "deactivate promotion", "disable promotion", "stop promotion"
        if (cmd.match(/^(deactivate|disable|stop|turn\s+off)\s+(the\s+)?promotion/)) {
            return {
                matched: true,
                action: 'deactivate',
                params: this._extractPromotionName(command)
            };
        }

        // Show promotions: "show promotions", "list promotions", "promotions"
        if (cmd.match(/^(show|list|view|get)\s+promotions?/) || cmd === 'promotions') {
            return {
                matched: true,
                action: 'show',
                params: { active: cmd.includes('active') }
            };
        }

        // Email about promotion: "email customers about promotion", "send promotion email"
        if (cmd.match(/^(email|send)\s+(customers?\s+)?(about\s+)?(the\s+)?promotion/)) {
            return {
                matched: true,
                action: 'email',
                params: this._extractPromotionName(command)
            };
        }

        return null;
    }

    /**
     * Extract parameters for create promotion command
     */
    _extractCreateParams(command) {
        const params = {};

        // Extract discount: "20%", "20 percent", "$20", "20 dollars"
        const percentMatch = command.match(/(\d+)\s*%|(\d+)\s*percent/i);
        const dollarMatch = command.match(/\$(\d+)|(\d+)\s*dollars?/i);

        if (percentMatch) {
            params.discount_type = 'percentage';
            params.discount_value = parseFloat(percentMatch[1] || percentMatch[2]);
        } else if (dollarMatch) {
            params.discount_type = 'fixed_amount';
            params.discount_value = parseFloat(dollarMatch[1] || dollarMatch[2]);
        }

        // Extract product/category: "for cookies", "on edibles", "for product X"
        const productMatch = command.match(/(?:for|on)\s+([a-z\s]+?)(?:\s|$|,|\.)/i);
        if (productMatch) {
            params.product_name = productMatch[1].trim();
        }

        // Extract name: "called X" or use product name
        const nameMatch = command.match(/called\s+([^,\.]+)/i);
        if (nameMatch) {
            params.name = nameMatch[1].trim();
        } else if (params.product_name && params.discount_value) {
            params.name = `${params.product_name} ${params.discount_value}${params.discount_type === 'percentage' ? '%' : '$'} Off`;
        }

        // Extract code: "code COOKIES20"
        const codeMatch = command.match(/code\s+([A-Z0-9]+)/i);
        if (codeMatch) {
            params.code = codeMatch[1].toUpperCase();
        }

        // Extract dates: "until Dec 31", "valid until..."
        const dateMatch = command.match(/until\s+([^,\.]+)/i);
        if (dateMatch) {
            // Simple date parsing - can be enhanced
            params.end_date = dateMatch[1].trim();
        }

        return params;
    }

    /**
     * Extract promotion name from command
     */
    _extractPromotionName(command) {
        // Try to extract promotion name after action word
        const match = command.match(/(?:promotion|sale|discount)\s+(?:called\s+)?([^,\.]+)/i);
        if (match) {
            return { name: match[1].trim() };
        }
        return {};
    }

    /**
     * Validate parameters
     */
    validate(parsed, context) {
        const action = parsed.action;
        const params = parsed.params || {};

        if (action === 'create') {
            if (!params.discount_type || !params.discount_value) {
                return {
                    valid: false,
                    error: 'Please specify discount amount (e.g., "20%" or "$20")',
                    suggestions: [
                        'Try: "create a 20% off promotion for cookies"',
                        'Try: "create a $10 off promotion"'
                    ]
                };
            }
        }

        return { valid: true };
    }

    /**
     * Execute promotion command
     * @param {object} parsed - Parsed command (contains action and params)
     * @param {object} context - Context (merchantId, customerId, etc.)
     */
    async execute(parsed, context) {
        const { merchantId } = context;

        if (!merchantId) {
            throw new Error('Merchant context required');
        }

        // Extract action and params from parsed object
        const action = parsed.action;
        const params = parsed.params || {};

        switch (action) {
            case 'create':
                return await this._createPromotion(params, merchantId);

            case 'activate':
                return await this._activatePromotion(params, merchantId);

            case 'deactivate':
                return await this._deactivatePromotion(params, merchantId);

            case 'show':
                return await this._showPromotions(params, merchantId);

            case 'email':
                return await this._emailPromotion(params, merchantId);

            default:
                throw new Error(`Unknown promotion action: ${action}`);
        }
    }

    /**
     * Create a new promotion
     */
    async _createPromotion(params, merchantId) {
        // Find product if product_name specified
        let productIds = null;
        if (params.product_name) {
            const products = db.searchProducts(params.product_name, merchantId);
            if (products.length > 0) {
                productIds = products.map(p => p.id);
            }
        }

        // Generate code if not provided
        let code = params.code;
        if (!code && params.name) {
            // Generate code from name: "Cookies 20% Off" -> "COOKIES20"
            code = params.name
                .replace(/[^a-z0-9]/gi, '')
                .substring(0, 10)
                .toUpperCase();

            // Ensure uniqueness
            const existing = db.getPromotions(merchantId, { code });
            if (existing.length > 0) {
                code = code + Math.floor(Math.random() * 100);
            }
        }

        const promotion = {
            id: uuidv4(),
            merchant_id: merchantId,
            name: params.name || `Promotion ${params.discount_value}${params.discount_type === 'percentage' ? '%' : '$'}`,
            description: params.description || `Special ${params.discount_type === 'percentage' ? params.discount_value + '%' : '$' + params.discount_value} discount`,
            discount_type: params.discount_type,
            discount_value: params.discount_value,
            code: code,
            product_ids: productIds,
            customer_segment: params.customer_segment || 'all',
            start_date: params.start_date || null,
            end_date: params.end_date || null,
            enabled: true
        };

        db.createPromotion(promotion);

        return {
            action: 'promotion_created',
            promotion: {
                id: promotion.id,
                name: promotion.name,
                code: promotion.code,
                discount: `${promotion.discount_value}${promotion.discount_type === 'percentage' ? '%' : '$'}`
            },
            message: `✅ Created promotion: "${promotion.name}" (Code: ${promotion.code || 'N/A'})`
        };
    }

    /**
     * Activate a promotion
     */
    async _activatePromotion(params, merchantId) {
        const promotions = db.getPromotions(merchantId);

        // Find promotion by name or code
        let promotion = null;
        if (params.name) {
            promotion = promotions.find(p =>
                p.name.toLowerCase().includes(params.name.toLowerCase()) ||
                p.code?.toLowerCase() === params.name.toLowerCase()
            );
        } else {
            // Activate most recent disabled promotion
            promotion = promotions.find(p => !p.enabled);
        }

        if (!promotion) {
            return {
                action: 'promotion_not_found',
                error: 'Promotion not found. Use "show promotions" to see available promotions.',
                suggestions: ['Try: "show promotions"', 'Try: "activate promotion [name]"']
            };
        }

        db.updatePromotion(promotion.id, merchantId, { enabled: true });

        return {
            action: 'promotion_activated',
            promotion: {
                id: promotion.id,
                name: promotion.name,
                code: promotion.code
            },
            message: `✅ Activated promotion: "${promotion.name}"`
        };
    }

    /**
     * Deactivate a promotion
     */
    async _deactivatePromotion(params, merchantId) {
        const promotions = db.getPromotions(merchantId, { enabled: 1 });

        let promotion = null;
        if (params.name) {
            promotion = promotions.find(p =>
                p.name.toLowerCase().includes(params.name.toLowerCase()) ||
                p.code?.toLowerCase() === params.name.toLowerCase()
            );
        } else {
            // Deactivate most recent active promotion
            promotion = promotions[0];
        }

        if (!promotion) {
            return {
                action: 'promotion_not_found',
                error: 'No active promotion found.',
                suggestions: ['Try: "show promotions" to see available promotions']
            };
        }

        db.updatePromotion(promotion.id, merchantId, { enabled: false });

        return {
            action: 'promotion_deactivated',
            promotion: {
                id: promotion.id,
                name: promotion.name
            },
            message: `✅ Deactivated promotion: "${promotion.name}"`
        };
    }

    /**
     * Show promotions
     */
    async _showPromotions(params, merchantId) {
        const filters = {};
        if (params.active) {
            filters.active = true;
        }

        const promotions = db.getPromotions(merchantId, filters);

        return {
            action: 'show_results',
            resultType: 'promotions',
            results: promotions.map(p => ({
                id: p.id,
                name: p.name,
                code: p.code,
                discount: `${p.discount_value}${p.discount_type === 'percentage' ? '%' : '$'}`,
                enabled: p.enabled === 1,
                start_date: p.start_date,
                end_date: p.end_date,
                current_uses: p.current_uses,
                max_uses: p.max_uses
            })),
            totalCount: promotions.length,
            message: `Found ${promotions.length} promotion${promotions.length !== 1 ? 's' : ''}`
        };
    }

    /**
     * Email customers about a promotion
     */
    async _emailPromotion(params, merchantId) {
        const promotions = db.getPromotions(merchantId, { enabled: 1 });

        let promotion = null;
        if (params.name) {
            promotion = promotions.find(p =>
                p.name.toLowerCase().includes(params.name.toLowerCase()) ||
                p.code?.toLowerCase() === params.name.toLowerCase()
            );
        } else {
            promotion = promotions[0]; // Use most recent active promotion
        }

        if (!promotion) {
            return {
                action: 'promotion_not_found',
                error: 'No active promotion found to email about.',
                suggestions: ['Try: "show promotions" to see available promotions', 'Try: "create promotion" first']
            };
        }

        // Get merchant info
        const merchant = db.getMerchant(merchantId);

        // Get all customers
        const orders = db.getAllOrders(merchantId);
        const customerMap = new Map();
        orders.forEach(order => {
            if (order.customer_email && !customerMap.has(order.customer_email)) {
                customerMap.set(order.customer_email, {
                    email: order.customer_email,
                    name: order.customer_name || order.customer_email
                });
            }
        });

        // Also get from customers table
        try {
            const customers = db.db.prepare('SELECT DISTINCT email, name FROM customers WHERE merchant_id = ? AND email IS NOT NULL').all(merchantId);
            customers.forEach(customer => {
                if (customer.email && !customerMap.has(customer.email)) {
                    customerMap.set(customer.email, {
                        email: customer.email,
                        name: customer.name || customer.email
                    });
                }
            });
        } catch (e) {
            // Ignore if query fails
        }

        const customers = Array.from(customerMap.values());

        if (customers.length === 0) {
            return {
                action: 'no_customers',
                error: 'No customers found to email.',
                suggestions: ['Customers will appear after they make purchases']
            };
        }

        // Send promotional emails
        let sent = 0;
        let failed = 0;

        for (const customer of customers) {
            try {
                await EmailService.sendPromotionalEmail(
                    customer.email,
                    customer.name,
                    {
                        name: promotion.name,
                        description: promotion.description,
                        discount_type: promotion.discount_type,
                        discount_value: promotion.discount_value,
                        code: promotion.code,
                        end_date: promotion.end_date
                    },
                    merchant?.name || 'Somo'
                );
                sent++;
            } catch (error) {
                console.error(`Failed to send promotional email to ${customer.email}:`, error);
                failed++;
            }
        }

        return {
            action: 'promotion_emailed',
            promotion: {
                id: promotion.id,
                name: promotion.name
            },
            sent,
            failed,
            total: customers.length,
            message: `✅ Sent promotional email about "${promotion.name}" to ${sent} customer${sent !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`
        };
    }
}

// Create singleton instance
const promotionCommandsInstance = new PromotionCommands();

// Export handler configuration for command system
module.exports = {
    parse: (command, context) => promotionCommandsInstance.parse(command, context),
    execute: (params, context) => promotionCommandsInstance.execute(params, context),
    validate: (params, context) => promotionCommandsInstance.validate(params, context),
    description: 'Manage promotions: create, activate, deactivate, show, and email customers',
    examples: [
        'create a 20% off promotion for cookies',
        'create promotion 15% off code SAVE15',
        'activate cookies promotion',
        'show promotions',
        'email customers about the cookies sale'
    ]
};

