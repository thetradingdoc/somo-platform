#!/usr/bin/env node

/**
 * List Top 2 Patients from Stedi API Sandbox
 * Displays patient data including copay, balance, and all insurance information
 */

require('dotenv').config();
const db = require('../database').db;
const path = require('path');

async function listStediPatients() {
  console.log('\n🏥 STEDI PATIENT DATA - TOP 2 PATIENTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
  // Query for patients with eligibility checks from Stedi
  // Join with patient data and insurance information
  const query = `
    SELECT 
      p.resource_id as patient_id,
      p.name as patient_name,
      p.phone,
      p.email,
      p.resource_data as patient_resource,
      e.id as eligibility_id,
      e.member_id,
      e.payer_id,
      e.service_code,
      e.date_of_service,
      e.eligible,
      e.copay_amount,
      e.allowed_amount,
      e.insurance_pays,
      e.deductible_total,
      e.deductible_remaining,
      e.coinsurance_percent,
      e.plan_summary,
      e.response_data,
      e.created_at as eligibility_created_at,
      pi.payer_name,
      pi.group_number,
      pi.plan_name,
      pi.relationship_code,
      pi.is_primary,
      pi.is_verified
    FROM eligibility_checks e
    LEFT JOIN fhir_patients p ON e.patient_id = p.resource_id
    LEFT JOIN patient_insurance pi ON e.patient_id = pi.patient_id AND e.payer_id = pi.payer_id
    WHERE e.patient_id IS NOT NULL
    ORDER BY e.created_at DESC
    LIMIT 2
  `;

  let patients = db.prepare(query).all();

  if (patients.length === 0) {
    console.log('⚠️  No patients found with Stedi eligibility data.');
    console.log('\n💡 Creating test eligibility data from existing patients...\n');
    
    // Get existing patients
    const existingPatients = db.prepare(`
      SELECT resource_id, name, phone, email, resource_data
      FROM fhir_patients
      WHERE is_deleted = 0
      LIMIT 2
    `).all();
    
    if (existingPatients.length === 0) {
      console.log('❌ No patients found in database at all.');
      console.log('\n💡 Tip: Create some patients first, or run:');
      console.log('   node scripts/restore-stedi-patients.js\n');
      process.exit(0);
    }
    
    // Create test eligibility data for existing patients
    const { v4: uuidv4 } = require('uuid');
    const InsuranceService = require('../services/insurance-service');
    
    for (const patient of existingPatients) {
      try {
        let patientData = {};
        try {
          if (patient.resource_data) {
            patientData = typeof patient.resource_data === 'string' 
              ? JSON.parse(patient.resource_data) 
              : patient.resource_data;
          }
        } catch (e) {}
        
        const nameParts = (patient.name || 'Test Patient').split(' ');
        const lastName = nameParts.pop() || 'Patient';
        const firstName = nameParts.join(' ') || 'Test';
        
        // Create test eligibility check
        const eligibilityData = {
          patientName: `${firstName} ${lastName}`,
          dateOfBirth: patientData.birthDate || '1980-01-01',
          memberId: `TEST${Math.floor(Math.random() * 1000000)}`,
          payerId: ['BCBS', 'AETNA', 'UHC'][Math.floor(Math.random() * 3)],
          serviceCode: '90834',
          dateOfService: new Date().toISOString().split('T')[0],
          patientId: patient.resource_id
        };
        
        console.log(`   Creating eligibility check for ${eligibilityData.patientName}...`);
        await InsuranceService.checkEligibility(eligibilityData);
      } catch (error) {
        console.warn(`   ⚠️  Error creating eligibility for ${patient.name}:`, error.message);
      }
    }
    
    console.log('\n✅ Test eligibility data created. Re-querying...\n');
    
    // Re-run the query
    const updatedPatients = db.prepare(query).all();
    if (updatedPatients.length > 0) {
      patients.push(...updatedPatients);
      patients = patients.slice(0, 2); // Limit to 2
    } else {
      console.log('❌ Still no eligibility data found after creation attempt.\n');
      process.exit(0);
    }
  }

  patients.forEach((patient, index) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`PATIENT #${index + 1}`);
    console.log(`${'='.repeat(60)}`);
    
    // Parse patient resource data if available
    let patientData = {};
    try {
      if (patient.patient_resource) {
        patientData = typeof patient.patient_resource === 'string' 
          ? JSON.parse(patient.patient_resource) 
          : patient.patient_resource;
      }
    } catch (e) {
      // Ignore parse errors
    }

    // Patient Basic Info
    console.log('\n📋 PATIENT INFORMATION:');
    console.log(`   Name:        ${patient.patient_name || patientData.name?.given?.[0] + ' ' + patientData.name?.family || 'N/A'}`);
    console.log(`   Patient ID:  ${patient.patient_id}`);
    console.log(`   Phone:       ${patient.phone || 'N/A'}`);
    console.log(`   Email:       ${patient.email || 'N/A'}`);
    
    if (patientData.birthDate) {
      console.log(`   DOB:         ${patientData.birthDate}`);
    }
    if (patientData.gender) {
      console.log(`   Gender:      ${patientData.gender}`);
    }

    // Insurance Information
    console.log('\n🏥 INSURANCE INFORMATION:');
    console.log(`   Payer ID:    ${patient.payer_id || 'N/A'}`);
    console.log(`   Payer Name:  ${patient.payer_name || patient.payer_id || 'N/A'}`);
    console.log(`   Member ID:   ${patient.member_id || 'N/A'}`);
    if (patient.group_number) {
      console.log(`   Group #:     ${patient.group_number}`);
    }
    if (patient.plan_name) {
      console.log(`   Plan Name:   ${patient.plan_name}`);
    }
    console.log(`   Primary:     ${patient.is_primary ? 'Yes' : 'No'}`);
    console.log(`   Verified:    ${patient.is_verified ? 'Yes' : 'No'}`);
    if (patient.relationship_code) {
      console.log(`   Relationship: ${patient.relationship_code}`);
    }

    // Eligibility & Coverage Details
    console.log('\n💰 COVERAGE & FINANCIAL INFORMATION:');
    console.log(`   Eligible:              ${patient.eligible ? '✅ Yes' : '❌ No'}`);
    console.log(`   Service Code:          ${patient.service_code || 'N/A'}`);
    console.log(`   Date of Service:       ${patient.date_of_service || 'N/A'}`);
    console.log(`   Copay Amount:          $${(patient.copay_amount || 0).toFixed(2)}`);
    console.log(`   Allowed Amount:        $${(patient.allowed_amount || 0).toFixed(2)}`);
    console.log(`   Insurance Pays:        $${(patient.insurance_pays || 0).toFixed(2)}`);
    
    if (patient.deductible_total !== null) {
      console.log(`   Deductible Total:      $${patient.deductible_total.toFixed(2)}`);
    }
    if (patient.deductible_remaining !== null) {
      console.log(`   Deductible Remaining: $${patient.deductible_remaining.toFixed(2)}`);
    }
    if (patient.coinsurance_percent !== null) {
      console.log(`   Coinsurance:          ${patient.coinsurance_percent}%`);
    }

    // Calculate patient responsibility
    if (patient.allowed_amount && patient.insurance_pays !== null) {
      const patientResponsibility = patient.allowed_amount - patient.insurance_pays;
      console.log(`   Patient Responsibility: $${patientResponsibility.toFixed(2)}`);
    }

    // Plan Summary
    if (patient.plan_summary) {
      console.log('\n📄 PLAN SUMMARY:');
      console.log(`   ${patient.plan_summary}`);
    }

    // Response Data (if available and contains additional info)
    if (patient.response_data) {
      try {
        const responseData = typeof patient.response_data === 'string' 
          ? JSON.parse(patient.response_data) 
          : patient.response_data;
        
        if (responseData && Object.keys(responseData).length > 0) {
          console.log('\n📊 ADDITIONAL STEDI RESPONSE DATA:');
          console.log(JSON.stringify(responseData, null, 2));
        }
      } catch (e) {
        // If response_data is not JSON, just show it as text
        if (patient.response_data.length < 500) {
          console.log('\n📊 RESPONSE DATA:');
          console.log(`   ${patient.response_data}`);
        }
      }
    }

    // Eligibility Check Metadata
    console.log('\n📅 ELIGIBILITY CHECK:');
    console.log(`   Check ID:    ${patient.eligibility_id}`);
    console.log(`   Created At:  ${patient.eligibility_created_at || 'N/A'}`);

    // Check for additional insurance records for this patient
    const additionalInsurance = db.prepare(`
      SELECT payer_id, payer_name, member_id, is_primary, plan_name
      FROM patient_insurance
      WHERE patient_id = ? AND (payer_id != ? OR payer_id IS NULL)
    `).all(patient.patient_id, patient.payer_id);

    if (additionalInsurance.length > 0) {
      console.log('\n🔄 ADDITIONAL INSURANCE POLICIES:');
      additionalInsurance.forEach((ins, idx) => {
        console.log(`   ${idx + 1}. ${ins.payer_name || ins.payer_id} - Member: ${ins.member_id} ${ins.is_primary ? '(Primary)' : ''}`);
      });
    }

    // Check for insurance claims
    const claims = db.prepare(`
      SELECT id, status, total_amount, copay_amount, insurance_amount, submitted_at
      FROM insurance_claims
      WHERE patient_id = ?
      ORDER BY submitted_at DESC
      LIMIT 5
    `).all(patient.patient_id);

    if (claims.length > 0) {
      console.log('\n💳 RECENT CLAIMS:');
      claims.forEach((claim, idx) => {
        console.log(`   ${idx + 1}. Claim ${claim.id.substring(0, 8)}... - Status: ${claim.status} - Amount: $${claim.total_amount?.toFixed(2) || '0.00'}`);
      });
    }
  });

  console.log('\n' + '='.repeat(60));
    console.log(`✅ Displayed ${patients.length} patient(s) with Stedi data`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Error fetching patient data:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the function
listStediPatients().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

