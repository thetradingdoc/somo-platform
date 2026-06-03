/**
 * Utility script to create a password-based tenant customer for an existing merchant
 * and send them a welcome email with login details.
 *
 * Usage:
 *   NODE_ENV=production node middleware-platform/scripts/create-tenant-customer.js <subdomain> <email> [name]
 *
 * Example:
 *   NODE_ENV=production node middleware-platform/scripts/create-tenant-customer.js akin-dunbar richard@callsomo.com "Somo Clinic"
 */

require('dotenv').config();

const crypto = require('crypto');
const path = require('path');

// Ensure we are running from project root
const projectRoot = path.join(__dirname, '..');
process.chdir(projectRoot);

const db = require('../database');
const EmailService = require('../services/email-service');

async function main() {
    const [subdomain, email, nameArg] = process.argv.slice(2);

    if (!subdomain || !email) {
        console.error('Usage: node middleware-platform/scripts/create-tenant-customer.js <subdomain> <email> [name]');
        process.exit(1);
    }

    const name = nameArg || email.split('@')[0];

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧑‍⚕️ Creating tenant customer');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(` Subdomain : ${subdomain}`);
    console.log(` Email     : ${email}`);
    console.log(` Name      : ${name}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Look up merchant by subdomain
    let merchant = db.getMerchantBySubdomain(subdomain);
    if (!merchant) {
        console.log(`ℹ️ No merchant found for subdomain "${subdomain}" – creating one now...`);

        const { v4: uuidv4 } = require('uuid');
        const merchantId = uuidv4();

        db.createMerchant({
            id: merchantId,
            name: `Clinic - ${subdomain}`,
            api_key: `managed-${crypto.randomBytes(8).toString('hex')}`,
            api_url: process.env.API_BASE_URL || 'https://api.callsomo.com',
            webhook_url: null,
            enabled_platforms: ['voice'],
            status: 'active',
            subdomain
        });

        merchant = db.getMerchantBySubdomain(subdomain);
        if (!merchant) {
            console.error(`❌ Failed to create merchant for subdomain "${subdomain}"`);
            process.exit(1);
        }

        console.log(`✅ Created merchant: ${merchant.id} (${merchant.name}) with subdomain: ${merchant.subdomain}`);
    } else {
        console.log(`✅ Found merchant: ${merchant.id} (${merchant.name})`);
    }

    // Check if customer already exists
    const existing = db.getCustomerByEmail ? db.getCustomerByEmail(email) : null;
    if (existing && existing.merchant_id === merchant.id) {
        console.log('ℹ️ Existing customer found for this merchant – updating credentials.');
    }

    // Generate a secure random password (used for new customer or to reset password)
    const plainPassword = crypto.randomBytes(8).toString('base64url'); // ~11 chars, URL-safe

    // Hash password using bcryptjs if available, otherwise SHA256 (same fallback as main code)
    let passwordHash = null;
    try {
        const bcrypt = require('bcryptjs');
        const saltRounds = 10;
        passwordHash = bcrypt.hashSync(plainPassword, saltRounds);
    } catch (err) {
        console.warn('⚠️ bcryptjs not available, using SHA256 hash as fallback (less secure).');
        passwordHash = crypto.createHash('sha256').update(plainPassword).digest('hex');
    }

    // Build customer record similar to signup flow
    const customerId = `cust_${crypto.randomBytes(12).toString('hex')}`;
    const nowIso = new Date().toISOString();

    const customerRecord = {
        id: customerId,
        name,
        email,
        phone_number: null,
        customer_type: 'saas',
        status: 'active',
        created_at: nowIso,
        updated_at: nowIso,
        merchant_id: merchant.id,
        clinic_id: null,
        password_hash: passwordHash,
        email_verified: 1,
        last_login_at: null
    };

    let targetCustomerId = customerId;

    try {
        if (existing) {
            // Update existing customer with merchant, password, and verification
            targetCustomerId = existing.id;
            db.updateCustomer(existing.id, {
                merchant_id: merchant.id,
                password_hash: passwordHash,
                status: 'active',
                email_verified: 1
            });
            console.log(`✅ Updated existing customer: ${existing.id}`);
        } else {
            db.createCustomer(customerRecord);
            console.log(`✅ Customer created: ${customerId}`);
        }
    } catch (err) {
        console.error('❌ Failed to create/update customer:', err);
        process.exit(1);
    }

    // Allocate starter credits (optional, keep small for manual tenants)
    try {
        const freeCredits = 250;
        if (typeof db.allocateFreeCredits === 'function') {
            db.allocateFreeCredits(targetCustomerId, freeCredits);
            console.log(`✅ Allocated ${freeCredits} free credits to customer ${targetCustomerId}`);
        }
    } catch (err) {
        console.warn('⚠️ Failed to allocate free credits:', err.message);
    }

    // Ensure terms are accepted for this tenant customer
    try {
        if (typeof db.acceptTerms === 'function') {
            db.acceptTerms(targetCustomerId, '1.0', 'system-script', 'tenant-bootstrap');
            console.log('✅ Terms accepted for customer');
        }
    } catch (err) {
        console.warn('⚠️ Failed to record terms acceptance:', err.message);
    }

    // Send welcome email with password and login URL
    try {
        await EmailService.sendWelcomeEmail(
            email,
            name,
            subdomain,
            'saas',
            merchant.id,
            plainPassword
        );
        console.log(`✅ Welcome email sent to ${email}`);
    } catch (err) {
        console.error('❌ Failed to send welcome email:', err);
        // Do not exit with error, as customer has been created
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Tenant customer setup complete');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch((err) => {
    console.error('❌ Unexpected error:', err);
    process.exit(1);
});


