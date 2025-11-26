#!/usr/bin/env node
/**
 * Find Patient Script
 * Searches for a patient by name, phone, or ID
 */

require('dotenv').config();
const db = require('../database');

const searchTerm = process.argv[2] || 'Jeremiah';

console.log(`\n🔍 Searching for patient: "${searchTerm}"\n`);

// Search by name
const patientsByName = db.searchFHIRPatients({ name: searchTerm, limit: 50 });

if (patientsByName && patientsByName.length > 0) {
  console.log(`✅ Found ${patientsByName.length} patient(s) by name:\n`);
  patientsByName.forEach((patient, index) => {
    const resourceData = patient.resource_data || {};
    const name = resourceData.name?.[0] 
      ? `${resourceData.name[0].given?.join(' ')} ${resourceData.name[0].family}`.trim()
      : patient.name || 'Unknown';
    const phone = resourceData.telecom?.find(t => t.system === 'phone')?.value || patient.phone || 'N/A';
    const email = resourceData.telecom?.find(t => t.system === 'email')?.value || patient.email || 'N/A';
    
    console.log(`${index + 1}. ${name}`);
    console.log(`   ID: ${patient.resource_id}`);
    console.log(`   Phone: ${phone}`);
    console.log(`   Email: ${email}`);
    console.log(`   Created: ${patient.created_at}`);
    console.log('');
  });
} else {
  console.log(`❌ No patients found with name containing "${searchTerm}"`);
}

// Also search all patients to see what's in the database
console.log('\n📋 All patients in database:');
const allPatients = db.prepare('SELECT resource_id, name, phone, email, created_at FROM fhir_patients WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 20').all();

if (allPatients && allPatients.length > 0) {
  console.log(`Found ${allPatients.length} total patients:\n`);
  allPatients.forEach((patient, index) => {
    console.log(`${index + 1}. ${patient.name || 'Unknown'} (ID: ${patient.resource_id})`);
    console.log(`   Phone: ${patient.phone || 'N/A'}, Email: ${patient.email || 'N/A'}`);
  });
} else {
  console.log('No patients found in database.');
}

console.log('\n');

