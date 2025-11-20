#!/usr/bin/env node

/**
 * Sync Test Patients to Production Database
 * This script creates the test patients (Sarah Johnson and Michael Williams)
 * with their Stedi insurance data in the production database
 */

require('dotenv').config();
const db = require('../database').db;
const FHIRService = require('../services/fhir-service');
const InsuranceService = require('../services/insurance-service');
const { v4: uuidv4 } = require('uuid');

console.log('\n🔄 SYNCING TEST PATIENTS TO PRODUCTION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

async function syncPatients() {
  try {
    // Define test patients with proper names and insurance data
    const testPatients = [
      {
        firstName: 'Sarah',
        lastName: 'Johnson',
        phone: '+18622307479',
        email: 'sarah.johnson@example.com',
        birthDate: '1985-05-20',
        memberId: 'TEST81941',
        payerId: 'AETNA',
        copay: 25,
        allowedAmount: 150,
        insurancePays: 125,
        deductibleTotal: 1000,
        deductibleRemaining: 600,
        coinsurancePercent: 20,
        planSummary: 'Standard PPO: outpatient mental health covered after copay; deductible applies to labs only.'
      },
      {
        firstName: 'Michael',
        lastName: 'Williams',
        phone: '+15551234567',
        email: 'michael.williams@example.com',
        birthDate: '1980-01-15',
        memberId: 'TEST902782',
        payerId: 'BCBS',
        copay: 20,
        allowedAmount: 150,
        insurancePays: 130,
        deductibleTotal: 500,
        deductibleRemaining: 200,
        coinsurancePercent: 20,
        planSummary: 'Covers outpatient mental health visits; prior auth not required for first 6 visits.'
      }
    ];

    let created = 0;
    let updated = 0;

    for (const patientData of testPatients) {
      try {
        const fullName = `${patientData.firstName} ${patientData.lastName}`;
        console.log(`\n📝 Processing: ${fullName}`);

        // Check if patient already exists
        const existingPatient = db.db.prepare('SELECT * FROM fhir_patients WHERE phone = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1').get(patientData.phone);
        
        let patientId;
        if (existingPatient) {
          console.log(`   ⏭️  Patient already exists, updating...`);
          patientId = existingPatient.resource_id;
          updated++;
        } else {
          // Create new patient
          console.log(`   ➕ Creating new patient...`);
          const patientResult = await FHIRService.getOrCreatePatient({
            name: {
              family: patientData.lastName,
              given: [patientData.firstName]
            },
            phone: patientData.phone,
            email: patientData.email,
            birthDate: patientData.birthDate
          }, false);

          if (!patientResult.patient) {
            console.warn(`   ⚠️  Failed to create patient ${fullName}`);
            continue;
          }

          patientId = patientResult.patient.id || patientResult.patient.resource_id;
          created++;
          console.log(`   ✅ Patient created: ${patientId}`);
        }

        // Check if eligibility check already exists
        const existingEligibility = db.prepare(`
          SELECT id FROM eligibility_checks
          WHERE patient_id = ? AND member_id = ? AND payer_id = ?
          LIMIT 1
        `).get(patientId, patientData.memberId, patientData.payerId);

        if (!existingEligibility) {
          // Create eligibility check
          console.log(`   💳 Creating eligibility check...`);
          const eligibilityId = `elig_${uuidv4()}`;
          
          db.prepare(`
            INSERT INTO eligibility_checks (
              id, patient_id, member_id, payer_id, service_code, date_of_service,
              eligible, copay_amount, allowed_amount, insurance_pays,
              deductible_total, deductible_remaining, coinsurance_percent,
              plan_summary, response_data, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(
            eligibilityId,
            patientId,
            patientData.memberId,
            patientData.payerId,
            '90834', // Common therapy CPT code
            new Date().toISOString().split('T')[0],
            1, // eligible
            patientData.copay,
            patientData.allowedAmount,
            patientData.insurancePays,
            patientData.deductibleTotal,
            patientData.deductibleRemaining,
            patientData.coinsurancePercent,
            patientData.planSummary,
            JSON.stringify({
              eligible: true,
              copay: patientData.copay,
              allowedAmount: patientData.allowedAmount,
              insurancePays: patientData.insurancePays,
              deductibleTotal: patientData.deductibleTotal,
              deductibleRemaining: patientData.deductibleRemaining,
              coinsurancePercent: patientData.coinsurancePercent,
              planSummary: patientData.planSummary,
              message: `Eligible - Copay $${patientData.copay}`
            })
          );

          console.log(`   ✅ Eligibility check created`);
        } else {
          console.log(`   ⏭️  Eligibility check already exists`);
        }

        // Create or update patient_insurance record
        const existingInsurance = db.prepare(`
          SELECT id FROM patient_insurance
          WHERE patient_id = ? AND payer_id = ? AND member_id = ?
          LIMIT 1
        `).get(patientId, patientData.payerId, patientData.memberId);

        if (!existingInsurance) {
          db.prepare(`
            INSERT INTO patient_insurance (
              id, patient_id, payer_id, payer_name, member_id,
              is_primary, is_verified, created_at
            ) VALUES (?, ?, ?, ?, ?, 1, 1, datetime('now'))
          `).run(
            uuidv4(),
            patientId,
            patientData.payerId,
            patientData.payerId,
            patientData.memberId
          );
          console.log(`   ✅ Insurance record created`);
        } else {
          console.log(`   ⏭️  Insurance record already exists`);
        }

      } catch (error) {
        console.error(`   ❌ Error processing ${patientData.firstName} ${patientData.lastName}:`, error.message);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Sync complete!`);
    console.log(`   Created: ${created} patients`);
    console.log(`   Updated: ${updated} patients`);
    console.log('='.repeat(60));
    console.log('\n📋 Test Patients Available:');
    testPatients.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.firstName} ${p.lastName} (${p.phone}) - ${p.payerId}`);
    });
    console.log('\n💡 These patients should now appear in the patient dropdown.\n');

  } catch (error) {
    console.error('\n❌ Error syncing patients:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the sync
syncPatients().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

