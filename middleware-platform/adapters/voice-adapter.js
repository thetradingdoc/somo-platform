/**
 * VOICE ADAPTER
 * 
 * Converts between Voice protocol format and standard payment format
 */

class VoiceAdapter {
    /**
     * Convert voice format products to simple format
     */
    static toVoiceFormat(products) {
        if (!Array.isArray(products)) {
            console.error('⚠️ VoiceAdapter.toVoiceFormat: products is not an array:', typeof products);
            return [];
        }

        return products.map((product, index) => {
            // Debug: Log first product structure
            if (index === 0) {
                console.log('🔍 VoiceAdapter: First product keys:', Object.keys(product));
                console.log('🔍 VoiceAdapter: First product.name:', product.name, 'type:', typeof product.name);
            }

            // Ensure we have valid data - check multiple possible name fields
            const name = product.name || product.Name || product.NAME || product.title || product.Title || 'Unnamed Product';
            const price = parseFloat(product.price || product.Price || 0) || 0;
            const inventory = parseInt(product.inventory || product.Inventory || 0) || 0;
            const description = product.description || product.Description || '';
            const category = product.category || product.Category || '';

            return {
                id: product.id || product.ID || '',
                name: name,
                description: this._truncateDescription(description),
                price: price.toFixed(2),
                price_spoken: `$${price.toFixed(2)}`,
                currency: 'USD',
                available: inventory > 0,
                inventory: inventory,
                category: category
            };
        });
    }

    /**
     * Truncate description for voice (keep it short)
     */
    static _truncateDescription(description) {
        if (!description) return '';
        if (description.length <= 100) return description;
        return description.substring(0, 97) + '...';
    }

    /**
     * Convert voice checkout request to standard payment request
     * 
     * HANDLES MULTIPLE FORMATS:
     * - Retell format (nested in req.body.args)
     * - Direct format (flat req.body)
     * - Other voice platforms
     */
    static toStandardPaymentRequest(rawRequest) {
        // Extract data from nested or flat format
        let data;

        if (rawRequest.args) {
            // Retell/nested format
            data = rawRequest.args;
        } else {
            // Direct format
            data = rawRequest;
        }

        // CRITICAL: Normalize phone number to +1 format for US customers
        const SMSService = require('../services/platform/sms-service');
        const normalizedPhone = data.customer_phone
            ? SMSService.formatPhoneNumber(data.customer_phone)
            : null;

        return {
            merchant_id: data.merchant_id,
            customer: {
                name: data.customer_name,
                phone: normalizedPhone,
                email: data.customer_email
            },
            items: [{
                product_id: data.product_id,
                quantity: data.quantity || 1
            }],
            payment: {
                method: data.payment_method || 'link',
                mandate_id: data.mandate_id || null,
                save_for_future: false,
                currency: 'USD'
            },
            source: {
                protocol: 'voice',
                platform: this._detectVoicePlatform(rawRequest),
                input_type: 'voice'
            },
            metadata: {
                original_request: rawRequest.call ? 'retell' : 'direct',
                mandate_id: data.mandate_id || null
            }
        };
    }

    /**
     * Detect which voice platform sent the request
     */
    static _detectVoicePlatform(request) {
        if (request.call && request.call.agent_id) return 'retell';
        if (request.vapi) return 'vapi';
        if (request.platform) return request.platform;
        return 'unknown';
    }

    /**
     * Convert standard payment response to voice format
     */
    static fromStandardResponse(standardResponse) {
        // Only set default message if successful and no error
        const defaultMessage = standardResponse.success && !standardResponse.error 
            ? 'Payment link sent via email' 
            : null;
        
        return {
            success: standardResponse.success,
            checkout_id: standardResponse.checkout_id,
            payment_token: standardResponse.payment_token,
            payment_link: standardResponse.payment_link,
            amount: standardResponse.payment?.amount?.toFixed(2),
            currency: standardResponse.payment?.currency || 'USD',
            email_sent: standardResponse.metadata?.email_sent || false,
            message: standardResponse.message || defaultMessage,
            error: standardResponse.error || null,
            requires_action: standardResponse.requires_action || false,
            action_type: standardResponse.action_type || null
        };
    }

    /**
     * Convert checkout to merchant order format
     */
    static toMerchantOrderFormat(checkout) {
        const ship =
            checkout.shipping_address != null && checkout.shipping_address !== ''
                ? typeof checkout.shipping_address === 'string'
                    ? checkout.shipping_address
                    : JSON.stringify(checkout.shipping_address)
                : null;
        return {
            customer_name: checkout.customer_name,
            customer_email: checkout.customer_email || checkout.customer_phone,
            customer_phone: checkout.customer_phone,
            shipping_address: ship,
            items: [{
                product_id: checkout.product_id,
                quantity: checkout.quantity,
                price: checkout.amount / checkout.quantity
            }],
            total: checkout.amount,
            payment_method: 'credit_card',
            payment_id: checkout.payment_intent_id || checkout.id,
            status: 'paid'
        };
    }
}

module.exports = VoiceAdapter;