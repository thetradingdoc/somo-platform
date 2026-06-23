require('dotenv').config();
const db = require('../database');
const CircleService = require('../services/platform/circle-service');
const FHIRResources = require('../models/fhir-resources');
const { v4: uuidv4 } = require('uuid');

const SUBDOMAIN = 'akin-dunbar';

async function main() {
    console.log(`\n💰 Creating wallets for ${SUBDOMAIN} customers\n`);

    // Get merchant
    const merchant = db.getMerchantBySubdomain(SUBDOMAIN);
    if (!merchant) {
        console.error(`❌ Merchant not found: ${SUBDOMAIN}`);
        process.exit(1);
    }
    console.log(`✅ Found merchant: ${merchant.id} (${merchant.name || SUBDOMAIN})\n`);

    // Get all voice checkouts for this merchant
    const checkouts = await db.getVoiceCheckoutsByMerchant(merchant.id);
    console.log(`📦 Found ${checkouts.length} voice checkouts\n`);

    // Extract unique customers
    const customersMap = new Map();
    for (const checkout of checkouts) {
        const key = checkout.customer_phone || checkout.customer_email || 'unknown';
        if (!customersMap.has(key)) {
            customersMap.set(key, {
                phone: checkout.customer_phone,
                email: checkout.customer_email,
                name: checkout.customer_name
            });
        }
    }
    console.log(`👥 Found ${customersMap.size} unique customers\n`);

    // Process each customer
    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const [key, customer] of customersMap) {
        try {
            if (!customer.phone && !customer.email) {
                console.log(`⚠️  Skipping customer (no phone/email): ${key}`);
                skipped++;
                continue;
            }

            // Find or create FHIR Patient
            let patient = null;
            if (customer.phone) {
                patient = db.getFHIRPatientByPhone(customer.phone);
            }
            if (!patient && customer.email) {
                patient = db.getFHIRPatientByEmail(customer.email);
            }

            // Create FHIR Patient if doesn't exist
            if (!patient) {
                const patientResource = FHIRResources.createPatient({
                    id: `patient-${uuidv4()}`,
                    phone: customer.phone,
                    email: customer.email,
                    firstName: customer.name?.split(' ')[0],
                    lastName: customer.name?.split(' ').slice(1).join(' ')
                });
                patientResource.merchant_id = merchant.id;
                db.createFHIRPatient(patientResource);
                patient = db.getFHIRPatient(patientResource.id);
                console.log(`✅ Created FHIR Patient: ${patient.resource_id}`);
            } else {
                // Update merchant_id if missing
                if (!patient.merchant_id) {
                    db.db.prepare('UPDATE fhir_patients SET merchant_id = ? WHERE resource_id = ?')
                        .run(merchant.id, patient.resource_id);
                    console.log(`✅ Updated merchant_id for patient: ${patient.resource_id}`);
                }
            }

            // Create wallet with merchant_id
            const walletResult = await CircleService.getOrCreatePatientWallet(patient.resource_id, {
                createIfNotExists: true,
                merchantId: merchant.id
            });

            if (walletResult.success) {
                // Update wallet merchant_id
                const account = db.getCircleAccountByEntity('patient', patient.resource_id);
                if (account && !account.merchant_id) {
                    db.db.prepare('UPDATE circle_accounts SET merchant_id = ? WHERE id = ?')
                        .run(merchant.id, account.id);
                }
                console.log(`✅ Wallet ready: ${walletResult.walletId || 'exists'}`);
                created++;
            } else {
                console.log(`⚠️  Wallet creation failed: ${walletResult.error}`);
                errors++;
            }
        } catch (error) {
            console.error(`❌ Error processing customer ${key}:`, error.message);
            errors++;
        }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Created/Updated: ${created}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Errors: ${errors}`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});

