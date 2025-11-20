/**
 * Update Patient Name in Production
 * Updates patient name from "Jeremiah Richie" to "Otieno Jeremiah"
 * 
 * Usage: node scripts/update-patient-name-production.js
 */

const db = require('../database');

const PATIENT_ID = 'patient-a8bd1117-78b4-453d-8a19-e382ca91e41b';
const NEW_NAME = {
  family: 'Otieno',
  given: ['Jeremiah']
};

async function updatePatientName() {
  console.log('\n🔄 UPDATING PATIENT NAME IN PRODUCTION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Patient ID: ${PATIENT_ID}`);
  console.log(`New Name: ${NEW_NAME.given.join(' ')} ${NEW_NAME.family}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Get current patient
    const patient = db.getFHIRPatient(PATIENT_ID);
    
    if (!patient) {
      console.error('❌ Patient not found:', PATIENT_ID);
      console.log('\n💡 This script should be run in production environment');
      console.log('   Patient exists in production database, not local dev database');
      process.exit(1);
    }

    // Parse resource data
    const resource = typeof patient.resource_data === 'string' 
      ? JSON.parse(patient.resource_data) 
      : patient.resource_data;

    const oldName = resource.name?.[0] 
      ? `${(resource.name[0].given || []).join(' ')} ${resource.name[0].family || ''}`.trim()
      : 'Unknown';

    console.log(`📋 Current Name: ${oldName}`);
    console.log(`📋 New Name: ${NEW_NAME.given.join(' ')} ${NEW_NAME.family}`);

    // Update name
    if (!resource.name || !resource.name[0]) {
      resource.name = [{}];
    }
    resource.name[0].family = NEW_NAME.family;
    resource.name[0].given = NEW_NAME.given;
    resource.name[0].use = 'official';

    // Update in database
    const result = db.updateFHIRPatient(PATIENT_ID, resource);

    if (result && result.changes > 0) {
      console.log('✅ Patient name updated successfully');
      
      // Also update appointment patient_name
      const appointments = db.getAllAppointments({}).filter(a => a.patient_id === PATIENT_ID);
      if (appointments.length > 0) {
        console.log(`\n📅 Updating ${appointments.length} appointment(s)...`);
        appointments.forEach(appt => {
          db.updateAppointment(appt.id, {
            patient_name: `${NEW_NAME.given.join(' ')} ${NEW_NAME.family}`
          });
          console.log(`   ✅ Updated appointment: ${appt.id}`);
        });
      }

      console.log('\n✅ Update complete!');
      console.log(`   Patient will now show as "Hi OJ" in dashboard`);
    } else {
      console.log('⚠️  No changes made');
    }

  } catch (error) {
    console.error('❌ Error updating patient name:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  updatePatientName()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { updatePatientName };

