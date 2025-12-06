/**
 * Utility script to reset password for a customer and display the new password
 * 
 * Usage:
 *   NODE_ENV=production node middleware-platform/scripts/reset-password.js <email>
 * 
 * Example:
 *   NODE_ENV=production node middleware-platform/scripts/reset-password.js akin.dunbar@gmail.com
 */

require('dotenv').config();

const crypto = require('crypto');
const path = require('path');

// Ensure we are running from project root
const projectRoot = path.join(__dirname, '..');
process.chdir(projectRoot);

const db = require('../database');

async function main() {
    const email = process.argv[2];

    if (!email) {
        console.error('Usage: node middleware-platform/scripts/reset-password.js <email>');
        process.exit(1);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔑 Resetting password for customer');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(` Email: ${email}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Get customer by email
    const customer = db.getCustomerByEmail(email);
    if (!customer) {
        console.error(`❌ Customer not found for email: ${email}`);
        process.exit(1);
    }

    console.log(`✅ Found customer: ${customer.id} (${customer.name})`);

    // Generate a secure random password
    const plainPassword = crypto.randomBytes(8).toString('base64url'); // ~11 chars, URL-safe

    // Hash password using bcryptjs if available
    let passwordHash = null;
    try {
        const bcrypt = require('bcryptjs');
        const saltRounds = 10;
        passwordHash = bcrypt.hashSync(plainPassword, saltRounds);
        console.log('✅ Password hashed using bcrypt');
    } catch (err) {
        console.warn('⚠️ bcryptjs not available, using SHA256 hash as fallback (less secure).');
        passwordHash = crypto.createHash('sha256').update(plainPassword).digest('hex');
    }

    // Update customer password
    try {
        db.updateCustomer(customer.id, {
            password_hash: passwordHash
        });
        console.log('✅ Password updated in database');
    } catch (err) {
        console.error('❌ Failed to update password:', err);
        process.exit(1);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ PASSWORD RESET COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('📧 Email:     ' + email);
    console.log('🔑 Password:  ' + plainPassword);
    console.log('');
    console.log('🌐 Login URL:');
    if (customer.merchant_id) {
        const merchant = db.getMerchant(customer.merchant_id);
        if (merchant && merchant.subdomain) {
            console.log('   https://' + merchant.subdomain + '.doclittle.site/login');
        }
    }
    console.log('   https://api.doclittle.site/login');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch((err) => {
    console.error('❌ Unexpected error:', err);
    process.exit(1);
});

