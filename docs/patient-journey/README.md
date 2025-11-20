# Patient Journey Documentation

This directory contains documentation for patient journey testing, demos, and workflows.

## 📁 Files

### [TEST_SCENARIO_JEREMIAH_RICHIE.md](./TEST_SCENARIO_JEREMIAH_RICHIE.md)
Complete test scenario for patient "Jeremiah Richie" (now "Otieno Jeremiah") covering the full user journey:
- Patient creation with STEDI insurance data
- Appointment booking
- Balance checks
- Copay features
- Medical record upload
- Medical code finding
- Invoice creation
- Claim submission to insurer
- EOB processing
- Patient wallet balance updates

### [DEMO_APPOINTMENT_SETUP.md](./DEMO_APPOINTMENT_SETUP.md)
Setup documentation for demo appointments, including:
- Business hours configuration
- Appointment creation for 6pm demo
- Email notifications
- Patient linking

### [PATIENT_RENAME_AND_INVOICE_EDITING.md](./PATIENT_RENAME_AND_INVOICE_EDITING.md)
Documentation for:
- Patient name updates (Jeremiah Richie → Otieno Jeremiah)
- Dashboard "Hi OJ" greeting implementation
- My Benefits section requirements
- Provider invoice editing requirements

## 🎯 Key Patient: Otieno Jeremiah

**Patient ID**: `patient-a8bd1117-78b4-453d-8a19-e382ca91e41b`  
**Name**: Otieno Jeremiah (displays as "Hi OJ" in dashboard)  
**Email**: doctorjay254@gmail.com  
**Phone**: +15551234567  
**Insurance**: UnitedHealthcare (Member ID: TEST999888)  
**Appointment**: November 21, 2025 at 6:00 PM

## 🔗 Related Documentation

- [STEDI API Endpoints](../integrations/STEDI_API_ENDPOINTS.md) - Insurance integration
- [Voice Agent Capabilities](../voice-agent/VOICE_AGENT_CAPABILITIES.md) - Voice booking
- [Deployment Documentation](../deployment/) - Production setup

