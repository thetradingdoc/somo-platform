#!/usr/bin/env node

/**
 * Update Test Patient Names
 * Gives proper names to test patients so they can be searched by voice agent
 */

require('dotenv').config();
const db = require('../database').db;
const FHIRResources = require('../models/fhir-resources');

console.log('\n👤 UPDATING TEST PATIENT NAMES');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

try {
  // Get the two patients with eligibility checks
  const patients = db.prepare(`
    SELECT DISTINCT
      p.resource_id,
      p.name,
      p.phone,
      p.resource_data
    FROM eligibility_checks e
    JOIN fhir_patients p ON e.patient_id = p.resource_id
    WHERE p.is_deleted = 0
    ORDER BY e.created_at DESC
    LIMIT 2
  `).all();

  if (patients.length === 0) {
    console.log('❌ No patients found with eligibility checks.');
    process.exit(0);
  }

  // Define proper names for the patients (keep existing phone numbers)
  const patientNames = [
    { firstName: 'Sarah', lastName: 'Johnson' },
    { firstName: 'Michael', lastName: 'Williams' }
  ];

  patients.forEach((patient, index) => {
    if (index >= patientNames.length) return;

    const newName = patientNames[index];
    const fullName = `${newName.firstName} ${newName.lastName}`;
    
    console.log(`\n📝 Updating Patient #${index + 1}:`);
    console.log(`   Old Name: ${patient.name || 'N/A'}`);
    console.log(`   New Name: ${fullName}`);
    console.log(`   Phone:    ${patient.phone || 'N/A'}`);

    try {
      // Parse existing resource data
      let resourceData = {};
      if (patient.resource_data) {
        resourceData = typeof patient.resource_data === 'string' 
          ? JSON.parse(patient.resource_data) 
          : patient.resource_data;
      }

      // Update name in resource data
      if (!resourceData.name) {
        resourceData.name = {};
      }
      resourceData.name.family = newName.lastName;
      resourceData.name.given = [newName.firstName];
      
      // Ensure resourceType is set
      resourceData.resourceType = 'Patient';
      
      // Ensure phone is in telecom array
      if (!resourceData.telecom) {
        resourceData.telecom = [];
      }
      // Update or add phone
      const phoneIndex = resourceData.telecom.findIndex(t => t.system === 'phone');
      if (phoneIndex >= 0) {
        resourceData.telecom[phoneIndex].value = patient.phone;
      } else if (patient.phone) {
        resourceData.telecom.push({
          system: 'phone',
          value: patient.phone,
          use: 'mobile'
        });
      }

      // Update the database (keep existing phone)
      db.prepare(`
        UPDATE fhir_patients
        SET name = ?,
            resource_data = ?,
            updated_at = datetime('now')
        WHERE resource_id = ?
      `).run(
        fullName,
        JSON.stringify(resourceData),
        patient.resource_id
      );

      console.log(`   ✅ Updated successfully!`);

    } catch (error) {
      console.error(`   ❌ Error updating patient:`, error.message);
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log('✅ Patient name updates complete!');
  console.log('='.repeat(60));
  console.log('\n📋 Updated Patients:');
  patients.forEach((patient, index) => {
    if (index < patientNames.length) {
      const name = patientNames[index];
      console.log(`   ${index + 1}. ${name.firstName} ${name.lastName} (${patient.phone || 'N/A'})`);
    }
  });
  console.log('\n💡 These patients can now be searched by the voice agent using their names.\n');

} catch (error) {
  console.error('\n❌ Error updating patient names:', error);
  console.error(error.stack);
  process.exit(1);
}

