/**
 * Application Constants
 * Centralized configuration values to avoid hardcoding throughout the codebase
 */

module.exports = {
    // Tenant Configuration
    TENANTS: {
        // Default tenant for backward compatibility (DEPRECATED - use tenant resolution instead)
        DEFAULT_SUBDOMAIN: process.env.DEFAULT_TENANT_SUBDOMAIN || 'akin-dunbar',

        // Tenant resolution methods
        RESOLUTION_METHODS: {
            SUBDOMAIN: 'subdomain',
            PHONE_NUMBER: 'phone_number',
            CLINIC_ID: 'clinic_id',
            MERCHANT_ID: 'merchant_id'
        }
    },

    // USDC Configuration
    USDC: {
        DECIMALS: 1000000, // USDC has 6 decimals
        TOKEN_ID_POLYGON_AMOY: '0x07865c6e87b9f70255377e024ace6630c1eaa37f', // Testnet
        DEFAULT_CURRENCY: 'USDC'
    },

    // Payment Configuration
    PAYMENT: {
        DEFAULT_CURRENCY: 'USD',
        DEFAULT_METHOD: 'link'
    },

    // Phone Number Configuration
    PHONE: {
        DEFAULT_COUNTRY_CODE: '+1',
        NORMALIZED_PLACEHOLDER: '0000000000' // Used when phone is missing
    },

    // Azure Configuration
    AZURE: {
        ROOT_DOMAIN: process.env.AZURE_ROOT_DOMAIN || 'doclittle.site',
        APP_NAME: process.env.AZURE_APP_NAME || 'doclittle',
        RESOURCE_GROUP: process.env.AZURE_RESOURCE_GROUP || 'doclittle',
        SKIP_SSL: process.env.AZURE_SKIP_SSL === 'true', // Allow skipping SSL in dev
        SSL_MAX_RETRIES: parseInt(process.env.AZURE_SSL_MAX_RETRIES || '3'),
        SSL_RETRY_DELAY_MS: parseInt(process.env.AZURE_SSL_RETRY_DELAY_MS || '60000') // 1 minute
    },

    // Environment
    ENV: {
        PRODUCTION: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod',
        DEVELOPMENT: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV,
        TEST: process.env.NODE_ENV === 'test'
    }
};

