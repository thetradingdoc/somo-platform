/**
 * RESTORE STEDI PATIENT DATA
 * 
 * This script restores FHIR patients from Stedi eligibility_checks data
 * that may have been lost or unlinked.
 * 
 * Run: node scripts/restore-stedi-patients.js
 */

require('dotenv').config();
const db = require('../database').db;
const FHIRService = require('../services/shared/fhir-service');
const { v4: uuidv4 } = require('uuid');

async function restoreStediPatients() {
    console.log('\n🔄 RESTORING STEDI PATIENT DATA');
    console.log('━'.repeat(60));
    console.log('');

    try {
        // Find all eligibility_checks with patient_id NULL or pointing to non-existent patients
        console.log('📋 Finding eligibility checks without linked patients...');

        const orphanedChecks = db.prepare(`
      SELECT DISTINCT 
        ec.member_id,
        ec.payer_id,
        ec.payer_name,
        ec.response_data,
        ec.created_at
      FROM eligibility_checks ec
      WHERE ec.patient_id IS NULL 
         OR ec.patient_id NOT IN (SELECT resource_id FROM fhir_patients WHERE is_deleted = 0)
      ORDER BY ec.created_at DESC
    `).all();

        console.log(`   Found ${orphanedChecks.length} eligibility checks without linked patients\n`);

        if (orphanedChecks.length === 0) {
            console.log('✅ No orphaned eligibility checks found. All patients are linked correctly.\n');
            return results;
        }

        // Also find eligibility_checks by unique member_id that might need patients
        const uniqueMemberIds = [...new Set(orphanedChecks.map(c => c.member_id))];
        console.log(`   Found ${uniqueMemberIds.length} unique member IDs needing patient records\n`);

        results.total = orphanedChecks.length;

        for (const check of orphanedChecks) {
            try {
                // Parse response_data to extract patient information
                let patientData = {
                    phone: null,
                    email: null,
                    name: null
                };

                if (check.response_data) {
                    try {
                        const response = typeof check.response_data === 'string'
                            ? JSON.parse(check.response_data)
                            : check.response_data;

                        // Try to extract patient info from Stedi response
                        if (response.patient_name) {
                            patientData.name = response.patient_name;
                        }
                        if (response.patient_phone) {
                            patientData.phone = response.patient_phone;
                        }
                        if (response.patient_email) {
                            patientData.email = response.patient_email;
                        }
                        // Check nested structures
                        if (response.subscriber && response.subscriber.name) {
                            patientData.name = response.subscriber.name;
                        }
                        if (response.subscriber && response.subscriber.phone) {
                            patientData.phone = response.subscriber.phone;
                        }
                    } catch (parseError) {
                        console.warn(`   ⚠️  Could not parse response_data for member_id ${check.member_id}`);
                    }
                }

                // Try to find existing patient by member_id in patient_insurance
                const existingInsurance = db.prepare(`
          SELECT patient_id, payer_id, member_id
          FROM patient_insurance
          WHERE member_id = ? AND payer_id = ?
          LIMIT 1
        `).get(check.member_id, check.payer_id);

                let patientId = null;

                if (existingInsurance && existingInsurance.patient_id) {
                    // Check if patient exists
                    const existingPatient = db.prepare(`
            SELECT resource_id FROM fhir_patients 
            WHERE resource_id = ? AND is_deleted = 0
          `).get(existingInsurance.patient_id);

                    if (existingPatient) {
                        patientId = existingInsurance.patient_id;
                        console.log(`   ✅ Found existing patient ${patientId} for member_id ${check.member_id}`);
                    }
                }

                // If no patient found, try to find by phone or email
                if (!patientId && patientData.phone) {
                    const patientByPhone = db.prepare(`
            SELECT resource_id FROM fhir_patients
            WHERE phone = ? AND is_deleted = 0
            LIMIT 1
          `).get(patientData.phone);

                    if (patientByPhone) {
                        patientId = patientByPhone.resource_id;
                        console.log(`   ✅ Found existing patient ${patientId} by phone ${patientData.phone}`);
                    }
                }

                if (!patientId && patientData.email) {
                    const patientByEmail = db.prepare(`
            SELECT resource_id FROM fhir_patients
            WHERE email = ? AND is_deleted = 0
            LIMIT 1
          `).get(patientData.email);

                    if (patientByEmail) {
                        patientId = patientByEmail.resource_id;
                        console.log(`   ✅ Found existing patient ${patientId} by email ${patientData.email}`);
                    }
                }

                // Create new patient if none found
                if (!patientId) {
                    // Create a basic patient from available data
                    // Use member_id as identifier if no name available
                    const patientName = patientData.name || `Member ${check.member_id}`;

                    const patientResult = await FHIRService.getOrCreatePatient({
                        name: {
                            family: patientName.split(' ').pop() || 'Unknown',
                            given: patientName.split(' ').slice(0, -1) || [patientName]
                        },
                        phone: patientData.phone,
                        email: patientData.email
                    }, false); // Don't require phone confirmation for restoration

                    if (patientResult.patient) {
                        patientId = patientResult.patient.id || patientResult.patient.resource_id;
                        results.created++;
                        console.log(`   ✅ Created new patient ${patientId} for member_id ${check.member_id}`);
                    } else {
                        results.skipped++;
                        console.warn(`   ⚠️  Could not create patient for member_id ${check.member_id}: ${patientResult.error || 'Unknown error'}`);
                        continue;
                    }
                }

                // Link eligibility_checks to patient
                const updateResult = db.prepare(`
          UPDATE eligibility_checks
          SET patient_id = ?
          WHERE member_id = ? AND payer_id = ? AND (patient_id IS NULL OR patient_id != ?)
        `).run(patientId, check.member_id, check.payer_id, patientId);

                if (updateResult.changes > 0) {
                    results.linked += updateResult.changes;
                    console.log(`   🔗 Linked ${updateResult.changes} eligibility check(s) to patient ${patientId}`);
                }

                // Ensure patient_insurance record exists
                const insuranceExists = db.prepare(`
          SELECT id FROM patient_insurance
          WHERE patient_id = ? AND member_id = ? AND payer_id = ?
        `).get(patientId, check.member_id, check.payer_id);

                if (!insuranceExists) {
                    const payer = db.prepare(`
            SELECT payer_name FROM insurance_payers WHERE payer_id = ?
          `).get(check.payer_id);

                    db.prepare(`
            INSERT INTO patient_insurance (
              id, patient_id, payer_id, payer_name, member_id, is_primary, is_verified
            ) VALUES (?, ?, ?, ?, ?, 1, 1)
          `).run(
                        uuidv4(),
                        patientId,
                        check.payer_id,
                        check.payer_name || payer?.payer_name || 'Unknown',
                        check.member_id
                    );
                    console.log(`   📋 Created patient_insurance record for patient ${patientId}`);
                }

            } catch (error) {
                console.error(`   ❌ Error processing member_id ${check.member_id}:`, error.message);
                results.skipped++;
            }
        }

        console.log('\n' + '━'.repeat(60));
        console.log('📊 RESTORATION SUMMARY');
        console.log('━'.repeat(60));
        console.log(`   ✅ Created: ${results.created} new patients`);
        console.log(`   🔗 Linked: ${results.linked} eligibility checks`);
        console.log(`   ⚠️  Skipped: ${results.skipped} records`);
        console.log(`   📝 Total processed: ${results.total}`);
        console.log('━'.repeat(60));
        console.log('');

        if (results.created > 0 || results.linked > 0) {
            console.log('✅ Stedi patient data restoration complete!');
            console.log('   Patients should now appear in the health provider portal.\n');
        } else {
            console.log('ℹ️  No new patients were created or linked.\n');
        }

        return results;

    } catch (error) {
        console.error('\n❌ Error restoring Stedi patients:', error);
        console.error(error.stack);
        throw error; // Re-throw for API endpoint handling
    }
}

// Export for API endpoint use
module.exports = { restoreStediPatients };

// Run the restoration if called directly
if (require.main === module) {
    restoreStediPatients().catch(error => {
        console.error('\n❌ Unexpected error:', error);
        process.exit(1);
    });
}

