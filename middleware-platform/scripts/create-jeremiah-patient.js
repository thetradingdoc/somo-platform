#!/usr/bin/env node
/**
 * Create Jeremiah Patient
 * Creates a test patient named Jeremiah Otieno for demo purposes
 */

require('dotenv').config();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const API_BASE_URL = process.env.API_BASE_URL || 'https://api.doclittle.site';

const patientData = {
  resourceType: 'Patient',
  id: `patient-${uuidv4()}`,
  identifier: [{
    system: 'https://doclittle.health/patient-id',
    value: `PAT-${Date.now()}`
  }],
  active: true,
  name: [{
    use: 'official',
    family: 'Otieno',
    given: ['Jeremiah']
  }],
  telecom: [
    {
      system: 'phone',
      value: '+18622307479', // From the logs - this is the caller's phone
      use: 'mobile'
    },
    {
      system: 'email',
      value: 'jeremiah.otieno@example.com'
    }
  ],
  gender: 'male',
  birthDate: '1985-01-15'
};

async function createPatient() {
  try {
    console.log('\n🏥 Creating patient: Jeremiah Otieno\n');
    console.log('Patient data:', JSON.stringify(patientData, null, 2));
    console.log('\n');

    const response = await axios.post(`${API_BASE_URL}/fhir/Patient`, patientData, {
      headers: {
        'Content-Type': 'application/fhir+json'
      }
    });

    if (response.data && response.data.resourceType === 'Patient') {
      console.log('✅ Patient created successfully!');
      console.log('\nPatient Details:');
      console.log(`  ID: ${response.data.id}`);
      console.log(`  Name: ${response.data.name?.[0]?.given?.join(' ')} ${response.data.name?.[0]?.family}`);
      console.log(`  Phone: ${response.data.telecom?.find(t => t.system === 'phone')?.value}`);
      console.log(`  Email: ${response.data.telecom?.find(t => t.system === 'email')?.value}`);
      console.log('\n');
      console.log('You can now search for this patient using:');
      console.log(`  ${API_BASE_URL}/api/patient/benefits?patientName=Jeremiah%20Otieno`);
      console.log(`  ${API_BASE_URL}/fhir/Patient?name=Jeremiah`);
    } else {
      console.log('⚠️  Unexpected response:', response.data);
    }
  } catch (error) {
    if (error.response) {
      console.error('❌ Error creating patient:', error.response.status, error.response.data);
      
      // Check if it's a duplicate
      if (error.response.status === 409 && error.response.data.duplicate) {
        console.log('\n⚠️  Duplicate patient detected. Existing patients:');
        if (error.response.data.duplicates) {
          error.response.data.duplicates.forEach((dup, i) => {
            console.log(`  ${i + 1}. ${dup.name} (ID: ${dup.patient_id})`);
          });
        }
      }
    } else {
      console.error('❌ Error:', error.message);
    }
  }
}

createPatient();

