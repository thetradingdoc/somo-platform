/**
 * SUBDOMAIN GENERATOR
 * Generates unique, URL-safe subdomains for tenants
 */

/**
 * Generate a unique subdomain from company name or merchant ID
 * @param {string} companyName - Company name to base subdomain on
 * @param {string} merchantId - Merchant ID as fallback
 * @param {Object} dbInstance - Database instance (passed to avoid circular dependency)
 * @returns {string} - Unique subdomain
 */
function generateSubdomain(companyName, merchantId, dbInstance) {
    // Start with company name or merchant ID
    let base = companyName || merchantId || 'tenant';

    // Convert to lowercase and remove special characters
    let subdomain = base
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-') // Replace non-alphanumeric with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
        .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

    // Ensure it's not empty
    if (!subdomain || subdomain.length === 0) {
        subdomain = 'tenant';
    }

    // Limit length (subdomains should be max 63 chars, but we'll use 40 for safety)
    if (subdomain.length > 40) {
        subdomain = subdomain.substring(0, 40);
    }

    // Check if subdomain already exists
    let finalSubdomain = subdomain;
    let counter = 1;

    while (isSubdomainTaken(finalSubdomain, dbInstance)) {
        // Append counter if subdomain is taken
        const suffix = `-${counter}`;
        const maxLength = 40 - suffix.length;
        finalSubdomain = subdomain.substring(0, maxLength) + suffix;
        counter++;

        // Safety check to prevent infinite loop
        if (counter > 1000) {
            // Fallback to UUID-based subdomain
            const { v4: uuidv4 } = require('uuid');
            finalSubdomain = `tenant-${uuidv4().substring(0, 8)}`;
            break;
        }
    }

    return finalSubdomain;
}

/**
 * Check if subdomain is already taken
 * @param {string} subdomain - Subdomain to check
 * @param {Object} dbInstance - Database instance (passed to avoid circular dependency)
 * @returns {boolean} - True if subdomain exists
 */
function isSubdomainTaken(subdomain, dbInstance) {
    try {
        if (!dbInstance) {
            // Lazy load db if not provided (for backward compatibility)
            const db = require('../database');
            dbInstance = db.db || db;
        }
        const existing = dbInstance.prepare('SELECT id FROM merchants WHERE subdomain = ?').get(subdomain);
        return !!existing;
    } catch (error) {
        console.error('Error checking subdomain:', error);
        // On error, assume it's taken to be safe
        return true;
    }
}

/**
 * Validate subdomain format
 * @param {string} subdomain - Subdomain to validate
 * @returns {boolean} - True if valid
 */
function isValidSubdomain(subdomain) {
    if (!subdomain || typeof subdomain !== 'string') {
        return false;
    }

    // Must be 1-63 characters (we use 40 max)
    if (subdomain.length < 1 || subdomain.length > 40) {
        return false;
    }

    // Must start and end with alphanumeric
    if (!/^[a-z0-9]/.test(subdomain) || !/[a-z0-9]$/.test(subdomain)) {
        return false;
    }

    // Can only contain lowercase letters, numbers, and hyphens
    if (!/^[a-z0-9-]+$/.test(subdomain)) {
        return false;
    }

    // Cannot have consecutive hyphens
    if (subdomain.includes('--')) {
        return false;
    }

    return true;
}

module.exports = {
    generateSubdomain,
    isSubdomainTaken,
    isValidSubdomain
};

