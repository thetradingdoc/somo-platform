# Voice Agent Documentation

This directory contains documentation for the Retell AI voice agent integration.

## 📁 Files

### [VOICE_AGENT_CAPABILITIES.md](./VOICE_AGENT_CAPABILITIES.md)
Complete list of 11 core voice agent functions:
1. `collect_insurance` - Collect and verify insurance information
2. `get_available_slots` - Get available appointment times
3. `schedule_appointment` - Book appointments
4. `search_appointments` - Find existing appointments
5. `confirm_appointment` - Confirm appointment details
6. `cancel_appointment` - Cancel appointments
7. `reschedule_appointment` - Reschedule appointments
8. `create_appointment_checkout` - Create payment checkout
9. `verify_checkout_code` - Verify payment codes
10. `get_patient_claims` - Get patient claim history
11. `end_call` - End the conversation

### [VOICE_AGENT_TEST_RESULTS.md](./VOICE_AGENT_TEST_RESULTS.md)
Production test results for voice agent functions, including:
- Function call success rates
- Response times
- Error handling
- Real conversation scenarios

## 🤖 Agent Details

**Name**: Kelly  
**Platform**: Retell AI  
**Voice**: Multilingual support  
**Integration**: Twilio for phone calls  
**Functions**: 11 core healthcare functions

## 📋 Prompt & Configuration

- **Prompt**: `docs/voice-agent/kelly-voice-agent-prompt.md`
- **Functions**: `middleware-platform/retell-functions/retell-functions.json`
- **Configuration**: `middleware-platform/configure-retell.js`

## 🔗 Related Documentation

- [Patient Journey](../patient-journey/) - Voice booking workflows
- [Deployment](../deployment/) - Production deployment
