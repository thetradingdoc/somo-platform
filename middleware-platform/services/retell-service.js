/**
 * RETELL API SERVICE
 * 
 * Handles automated Retell agent creation and management for multi-tenant clinics
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

class RetellService {
  constructor() {
    this.apiKey = process.env.RETELL_API_KEY;
    this.apiBaseUrl = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
    this.llmWebsocketUrl = process.env.RETELL_LLM_WEBSOCKET_URL || 'wss://doclittle.site/retell-llm';
  }

  /**
   * Generate clinic-specific prompt from template
   */
  generateClinicPrompt(clinicData) {
    try {
      // Read base prompt template
      const templatePath = path.join(__dirname, '../../docs/voice-agent/kelly-voice-agent-prompt.md');
      let template = fs.readFileSync(templatePath, 'utf8');
      
      // Replace clinic-specific placeholders
      template = template.replace(/{{CLINIC_NAME}}/g, clinicData.name || 'the clinic');
      template = template.replace(/{{CLINIC_DESCRIPTION}}/g, clinicData.description || 'a healthcare practice');
      template = template.replace(/{{BUSINESS_HOURS}}/g, clinicData.business_hours || 'Monday-Friday, 9 AM - 5 PM');
      template = template.replace(/{{PHONE_NUMBER}}/g, clinicData.phone_number || '');
      template = template.replace(/{{ADDRESS}}/g, clinicData.address || '');
      
      return template;
    } catch (error) {
      console.error('Error generating clinic prompt:', error);
      // Fallback to default prompt
      return this.getDefaultPrompt(clinicData);
    }
  }

  /**
   * Get default prompt if template fails
   */
  getDefaultPrompt(clinicData) {
    return `You are Kelly, the AI voice receptionist for ${clinicData.name || 'the clinic'}.

You are friendly, professional, and helpful. Your role is to:
- Answer incoming calls and greet patients
- Schedule appointments
- Collect insurance information
- Check eligibility and benefits
- Answer questions about services and coverage
- Process payments when requested

Clinic Name: ${clinicData.name || 'Unknown'}
Business Hours: ${clinicData.business_hours || 'Monday-Friday, 9 AM - 5 PM'}
Phone: ${clinicData.phone_number || 'N/A'}

Always be polite, patient, and professional. If you don't know something, ask for clarification or offer to connect the caller with a staff member.`;
  }

  /**
   * Load Retell functions configuration
   */
  loadRetellFunctions() {
    // Return the functions that the voice agent can call
    // These should match what's in the Retell WebSocket handler
    return [
      {
        name: 'schedule_appointment',
        description: 'Schedule an appointment for a patient',
        parameters: {
          type: 'object',
          properties: {
            patient_name: { type: 'string', description: 'Patient full name' },
            patient_phone: { type: 'string', description: 'Patient phone number (required)' },
            patient_email: { type: 'string', description: 'Patient email address' },
            appointment_type: { type: 'string', description: 'Type of appointment' },
            date: { type: 'string', description: 'Appointment date (YYYY-MM-DD)' },
            time: { type: 'string', description: 'Appointment time (HH:MM)' },
            timezone: { type: 'string', description: 'Timezone (default: America/New_York)' },
            notes: { type: 'string', description: 'Additional notes' }
          },
          required: ['patient_name', 'patient_phone', 'appointment_type', 'date', 'time']
        }
      },
      {
        name: 'collect_insurance',
        description: 'Collect and verify insurance information from a patient',
        parameters: {
          type: 'object',
          properties: {
            patient_name: { type: 'string', description: 'Patient full name' },
            patient_phone: { type: 'string', description: 'Patient phone number' },
            member_id: { type: 'string', description: 'Insurance member ID' },
            group_number: { type: 'string', description: 'Insurance group number' },
            payer_name: { type: 'string', description: 'Insurance payer name (e.g., CIGNA, Aetna)' },
            date_of_birth: { type: 'string', description: 'Patient date of birth (YYYY-MM-DD)' }
          },
          required: ['patient_name', 'member_id', 'payer_name']
        }
      },
      {
        name: 'get_patient_claims',
        description: 'Get patient insurance claims and benefits information',
        parameters: {
          type: 'object',
          properties: {
            patient_name: { type: 'string', description: 'Patient full name' },
            member_id: { type: 'string', description: 'Insurance member ID' }
          },
          required: ['member_id']
        }
      },
      {
        name: 'process_payment',
        description: 'Process a payment for a patient',
        parameters: {
          type: 'object',
          properties: {
            patient_name: { type: 'string', description: 'Patient full name' },
            patient_phone: { type: 'string', description: 'Patient phone number' },
            amount: { type: 'number', description: 'Payment amount' },
            description: { type: 'string', description: 'Payment description' }
          },
          required: ['patient_name', 'patient_phone', 'amount']
        }
      }
    ];
  }

  /**
   * Create a Retell agent for a clinic
   */
  async createAgent(clinicData) {
    if (!this.apiKey) {
      console.warn('⚠️  RETELL_API_KEY not configured. Running in mock mode.');
      return {
        success: false,
        error: 'Retell API key not configured',
        mock: true,
        agent_id: `mock-agent-${Date.now()}`
      };
    }

    try {
      const prompt = this.generateClinicPrompt(clinicData);
      const functions = this.loadRetellFunctions();

      const agentPayload = {
        agent_name: `${clinicData.name} Voice Assistant`,
        llm_websocket_url: this.llmWebsocketUrl,
        voice_id: clinicData.voice_id || '11labs-Adrian',
        language: 'en-US',
        enable_transcription: true,
        enable_recording: true,
        system_prompt: prompt,
        functions: functions,
        response_delay: 400,
        interruption_threshold: 500,
        enable_backchannel: true
      };

      console.log(`📞 Creating Retell agent for clinic: ${clinicData.name}`);
      console.log(`   Agent name: ${agentPayload.agent_name}`);
      console.log(`   WebSocket URL: ${agentPayload.llm_websocket_url}`);

      const response = await axios.post(
        `${this.apiBaseUrl}/v2/create-agent`,
        agentPayload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 second timeout
        }
      );

      if (response.data && response.data.agent_id) {
        console.log(`✅ Retell agent created successfully: ${response.data.agent_id}`);
        return {
          success: true,
          agent_id: response.data.agent_id,
          agent_data: response.data
        };
      } else {
        throw new Error('Invalid response from Retell API: missing agent_id');
      }
    } catch (error) {
      console.error('❌ Failed to create Retell agent:', error.message);
      if (error.response) {
        console.error('   Response status:', error.response.status);
        console.error('   Response data:', error.response.data);
      }
      
      return {
        success: false,
        error: error.message,
        error_details: error.response?.data || null
      };
    }
  }

  /**
   * Update a Retell agent
   */
  async updateAgent(agentId, updates) {
    if (!this.apiKey) {
      console.warn('⚠️  RETELL_API_KEY not configured. Cannot update agent.');
      return {
        success: false,
        error: 'Retell API key not configured'
      };
    }

    try {
      const updatePayload = {};
      
      if (updates.system_prompt) {
        updatePayload.system_prompt = updates.system_prompt;
      }
      if (updates.agent_name) {
        updatePayload.agent_name = updates.agent_name;
      }
      if (updates.voice_id) {
        updatePayload.voice_id = updates.voice_id;
      }
      if (updates.functions) {
        updatePayload.functions = updates.functions;
      }

      console.log(`📞 Updating Retell agent: ${agentId}`);

      const response = await axios.patch(
        `${this.apiBaseUrl}/v2/update-agent/${agentId}`,
        updatePayload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log(`✅ Retell agent updated successfully: ${agentId}`);
      return {
        success: true,
        agent_data: response.data
      };
    } catch (error) {
      console.error('❌ Failed to update Retell agent:', error.message);
      if (error.response) {
        console.error('   Response status:', error.response.status);
        console.error('   Response data:', error.response.data);
      }
      
      return {
        success: false,
        error: error.message,
        error_details: error.response?.data || null
      };
    }
  }

  /**
   * Get agent details
   */
  async getAgent(agentId) {
    if (!this.apiKey) {
      console.warn('⚠️  RETELL_API_KEY not configured. Cannot get agent.');
      return {
        success: false,
        error: 'Retell API key not configured'
      };
    }

    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/v2/get-agent/${agentId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout: 10000
        }
      );

      return {
        success: true,
        agent_data: response.data
      };
    } catch (error) {
      console.error('❌ Failed to get Retell agent:', error.message);
      return {
        success: false,
        error: error.message,
        error_details: error.response?.data || null
      };
    }
  }
}

module.exports = RetellService;
