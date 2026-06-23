/**
 * RETELL API SERVICE
 * 
 * Handles automated Retell agent creation and management for multi-tenant clinics
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Retell `voice_id` (e.g. retell-Cimo, openai-Alloy, 11labs-Adrian). Retell still handles the call;
 * this only selects which TTS voice Retell uses. Override per clinic via clinicData.voice_id.
 */
function resolveRetellVoiceId(clinicOverride) {
  if (clinicOverride && String(clinicOverride).trim()) return String(clinicOverride).trim();
  const envId = process.env.RETELL_VOICE_ID;
  if (envId && String(envId).trim()) return String(envId).trim();
  return 'retell-Cimo';
}

/** Canonical Retell custom-LLM WebSocket URL from API_BASE_URL / BASE_URL. */
function resolveLlmWebsocketUrl() {
  if (process.env.RETELL_LLM_WEBSOCKET_URL && String(process.env.RETELL_LLM_WEBSOCKET_URL).trim()) {
    return String(process.env.RETELL_LLM_WEBSOCKET_URL).trim().replace(/\/+$/, '');
  }
  const base = process.env.API_BASE_URL || process.env.BASE_URL || '';
  if (base && !base.includes('localhost') && !base.includes('127.0.0.1')) {
    const wsBase = String(base).trim().replace(/\/+$/, '').replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
    return `${wsBase}/webhook/retell/llm`;
  }
  return 'ws://localhost:4000/webhook/retell/llm';
}

class RetellService {
  constructor() {
    this.apiKey = process.env.RETELL_API_KEY;
    this.apiBaseUrl = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
    // Canonical path is /webhook/retell/llm (server.js upgrade handler + RetellWebSocketHandler).
    this.llmWebsocketUrl = resolveLlmWebsocketUrl();
  }

  /**
   * Load sales agent prompt from file
   */
  loadSalesPrompt() {
    try {
      const possiblePaths = [
        path.join(__dirname, '../../docs/voice-agent/sales-agent-prompt.md'), // Local dev
        path.join(__dirname, '../docs/voice-agent/sales-agent-prompt.md'), // Azure (if docs copied)
        path.join(process.cwd(), 'docs/voice-agent/sales-agent-prompt.md') // Fallback
      ];

      for (const templatePath of possiblePaths) {
        try {
          if (fs.existsSync(templatePath)) {
            const prompt = fs.readFileSync(templatePath, 'utf8');
            console.log('✅ Loaded sales agent prompt');
            return prompt;
          }
        } catch (e) {
          continue;
        }
      }

      console.warn('⚠️  Sales prompt file not found, using default sales prompt');
      return this.getDefaultSalesPrompt();
    } catch (error) {
      console.error('Error loading sales prompt:', error);
      return this.getDefaultSalesPrompt();
    }
  }

  /**
   * Get default sales prompt if file not found
   */
  getDefaultSalesPrompt() {
    return `You are Alex, an AI sales representative calling from Somo, a leading provider of AI-powered medical billing software for healthcare clinics.

Your mission is to call medical clinics to introduce Somo's medical billing software and schedule demos with interested clinics.

Call Opening: "Hi, this is Alex calling from Somo. I'm reaching out because I noticed you're looking to hire a medical receptionist. We provide AI-powered medical billing software that can help automate many of the tasks a receptionist handles—like insurance verification, appointment scheduling, and claims processing—which could reduce your staffing needs and costs.

I'd love to schedule a quick 15-minute demo to show you how we can help your clinic. Is this a good time to talk, or would you prefer I call back at a better time?"

Key Value Propositions:
- Automates repetitive billing tasks (insurance verification, claims submission, payment posting)
- Reduces billing overhead and staffing costs
- Improves claim acceptance rates (typically 95%+)
- Frees up staff to focus on patient care
- HIPAA compliant and secure

Always be professional, respectful, and helpful. If they're not interested, thank them for their time and end the call gracefully.`;
  }

  /**
   * Load shop-specific prompt (inline default; commerce prompt file removed 2026-06-17)
   */
  loadShopPrompt() {
    return this.getDefaultShopPrompt();
  }

  /**
   * Get default shop prompt if file not found
   */
  getDefaultShopPrompt() {
    return `You are a helpful and friendly voice commerce assistant for Somo.

Goal: Help customers browse products, place orders, track shipments, and manage their purchases through voice calls.

Keep it friendly, professional, and efficient—you're helping people shop and buy products.

Always introduce yourself as: "Hi, I'm your shopping assistant. How can I help you today?"

What You Can Do:
- Search for products by name, category, or description
- Provide product details (price, availability, description)
- Create checkout sessions for purchases
- Track order status and shipping information
- Answer questions about products and orders
- Process payments via secure email verification

Rules:
- Start with name only - Ask for full name first, then greet them personally
- Collect information progressively - Don't ask for everything upfront
- Email only when creating checkout or processing payment
- Never collect card numbers or payment over the phone
- Use natural phrasing, acknowledge the caller, and summarize next steps
- Be friendly and efficient—shopping should be easy and enjoyable`;
  }

  /**
   * Generate clinic-specific prompt from template
   */
  generateClinicPrompt(clinicData) {
    try {
      // Read base prompt template
      // Try multiple possible paths (local dev vs Azure deployment)
      const possiblePaths = [
        path.join(__dirname, '../../docs/voice-agent/prompts/kelly-voice-agent-prompt.md'), // Canonical docs path
        path.join(__dirname, '../../docs/voice-agent/kelly-voice-agent-prompt.md'), // Local dev
        path.join(__dirname, '../docs/voice-agent/kelly-voice-agent-prompt.md'), // Azure (if docs copied)
        path.join(process.cwd(), 'docs/voice-agent/kelly-voice-agent-prompt.md') // Fallback
      ];
      
      let template = null;
      for (const templatePath of possiblePaths) {
        try {
          if (fs.existsSync(templatePath)) {
            template = fs.readFileSync(templatePath, 'utf8');
            break;
          }
        } catch (e) {
          // Try next path - silently continue
          continue;
        }
      }
      
      // If template file not found, fall through to default prompt
      if (!template) {
        console.log('⚠️  Prompt file not found, using default prompt');
        return this.getDefaultPrompt(clinicData);
      }
      
      // Replace clinic-specific placeholders
      template = template.replace(/{{CLINIC_NAME}}/g, clinicData.name || 'the clinic');
      template = template.replace(/{{CLINIC_DESCRIPTION}}/g, clinicData.description || 'a healthcare practice');
      template = template.replace(/{{BUSINESS_HOURS}}/g, clinicData.business_hours || 'Monday-Friday, 9 AM - 5 PM');
      template = template.replace(/{{PHONE_NUMBER}}/g, clinicData.phone_number || '');
      template = template.replace(/{{ADDRESS}}/g, clinicData.address || '');

      // Hard requirement: medical workflow prompt must be present when creating/updating agents.
      // Without it, calls can degrade silently: tools exist but Kelly is not instructed to call them in order.
      const medicalPaths = [
        path.join(__dirname, '../../docs/voice-agent/medical-voice-agent-prompt.md'),
        path.join(__dirname, '../docs/voice-agent/medical-voice-agent-prompt.md'),
        path.join(process.cwd(), 'docs/voice-agent/medical-voice-agent-prompt.md')
      ];
      let medical = null;
      for (const mp of medicalPaths) {
        try {
          if (fs.existsSync(mp)) {
            medical = fs.readFileSync(mp, 'utf8');
            break;
          }
        } catch (_) { /* try next */ }
      }
      if (!medical) {
        throw new Error('Missing required docs/voice-agent/medical-voice-agent-prompt.md (medical workflow prompt)');
      }

      return template + '\n\n---\n\n' + medical;
    } catch (error) {
      console.error('Error generating clinic prompt:', error);
      // Fail-fast: prompt drift/missing workflow prompt should not silently degrade calls.
      throw error;
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

**MULTILINGUAL SUPPORT**: You are fluent in multiple languages including English, Russian, Spanish, Chinese, French, and German. You MUST automatically detect the language being spoken by the caller. If a caller starts speaking in Russian, Spanish, Chinese, French, or German (even without explicitly saying so), immediately switch to that language and continue the entire conversation in their preferred language. Do NOT wait for explicit language requests - detect the language from what they're saying.

Clinic Name: ${clinicData.name || 'Unknown'}
Business Hours: ${clinicData.business_hours || 'Monday-Friday, 9 AM - 5 PM'}
Phone: ${clinicData.phone_number || 'N/A'}

Always be polite, patient, and professional. If you don't know something, ask for clarification or offer to connect the caller with a staff member.`;
  }

  /**
   * Load Retell functions configuration for sales agent
   */
  loadSalesAgentFunctions() {
    const all = this.loadRetellFunctions();
    const allow = new Set(['schedule_demo', 'collect_contact_info', 'end_call']);
    return (Array.isArray(all) ? all : []).filter((t) => allow.has(t?.name));
  }

  /**
   * Load Retell functions configuration
   */
  loadRetellFunctions() {
    // Single source of truth: middleware-platform/retell-functions/retell-functions.json
    // (shared by configure-retell.js and RetellService.createAgent()).
    const candidatePaths = [
      path.join(__dirname, '../retell-functions/retell-functions.json'),
      path.join(process.cwd(), 'middleware-platform/retell-functions/retell-functions.json')
    ];
    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) {
          const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (Array.isArray(parsed?.functions) && parsed.functions.length > 0) {
            return parsed.functions;
          }
        }
      } catch (e) {
        console.warn('⚠️  Failed to load retell-functions.json:', e.message);
      }
    }
    console.warn('⚠️  retell-functions.json not found; using minimal fallback tool set');
    return [{ type: 'end_call', name: 'end_call', description: 'End the call when the conversation is complete', parameters: { type: 'object', properties: {} } }];
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
        response_engine: {
          type: 'custom-llm',
          llm_websocket_url: this.llmWebsocketUrl
        },
        voice_id: resolveRetellVoiceId(clinicData.voice_id),
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

      // Try multiple possible Retell API endpoints
      const possibleEndpoints = [
        '/v2/create-agent',
        '/create-agent',
        '/v2/agents',
        '/v2/agent'
      ];

      let lastError = null;
      let response = null;

      for (const endpoint of possibleEndpoints) {
        try {
          console.log(`   Trying endpoint: ${this.apiBaseUrl}${endpoint}`);
          response = await axios.post(
            `${this.apiBaseUrl}${endpoint}`,
        agentPayload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 second timeout
        }
      );

          // If we got a response, break out of the loop
          if (response && response.status < 400) {
            console.log(`✅ Successfully used endpoint: ${endpoint}`);
            break;
          }
        } catch (endpointError) {
          lastError = endpointError;
          // If it's a 404, try next endpoint
          if (endpointError.response && endpointError.response.status === 404) {
            console.log(`   Endpoint ${endpoint} returned 404, trying next...`);
            continue;
          }
          // If it's a different error (auth, validation, etc.), break and report
          break;
        }
      }

      if (response && response.data && response.data.agent_id) {
        console.log(`✅ Retell agent created successfully: ${response.data.agent_id}`);
        return {
          success: true,
          agent_id: response.data.agent_id,
          agent_data: response.data
        };
      } else if (response && response.data) {
        // Response received but no agent_id - might be different response format
        console.warn('⚠️  Retell API response received but format unexpected:', response.data);
        throw new Error('Invalid response from Retell API: unexpected response format');
      } else {
        throw lastError || new Error('All Retell API endpoints failed');
      }
    } catch (error) {
      console.error('❌ Failed to create Retell agent:', error.message);
      if (error.response) {
        console.error('   Response status:', error.response.status);
        console.error('   Response data:', JSON.stringify(error.response.data, null, 2));
        console.error('   Endpoint attempted:', error.config?.url);
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
      
      // Retell API v2 uses 'general_prompt' for updates (not 'system_prompt')
      if (updates.system_prompt) {
        updatePayload.general_prompt = updates.system_prompt;
      }
      if (updates.general_prompt) {
        updatePayload.general_prompt = updates.general_prompt;
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

      // Retell API uses /update-agent/ endpoint (not /v2/agent/)
      const response = await axios.patch(
        `${this.apiBaseUrl}/update-agent/${agentId}`,
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
        `${this.apiBaseUrl}/get-agent/${agentId}`,
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

  /**
   * Create an outbound phone call using Retell API
   * Once SIP trunk is configured in Retell dashboard, this will work properly.
   * 
   * @param {string} agentId - Retell agent ID to use for the call (optional if override_agent_id is provided)
   * @param {string} fromNumber - Your Twilio number (E.164 format, e.g., +15856202445)
   * @param {string} toNumber - Target phone number (E.164 format)
   * @param {Object} options - Additional options including metadata and dynamic variables
   * @param {string} options.override_agent_id - Override agent ID for this call (recommended)
   * @param {Object} options.retell_llm_dynamic_variables - Dynamic variables accessible in prompt
   * @param {Object} options.metadata - Additional metadata for the call
   * @returns {Promise<Object>} Call creation response with call_id
   */
  async createOutboundCall(agentId, fromNumber, toNumber, options = {}) {
    if (!this.apiKey) {
      throw new Error('RETELL_API_KEY not configured');
    }

    // Use override_agent_id from options if provided, otherwise use agentId parameter
    const effectiveAgentId = options.override_agent_id || agentId;
    
    if (!effectiveAgentId) {
      throw new Error('Agent ID is required (provide as parameter or in options.override_agent_id)');
    }

    if (!fromNumber || !toNumber) {
      throw new Error('Both from_number and to_number are required');
    }

    try {
      // Build call payload matching Retell API requirements
      // Retell requires all dynamic variables to be strings
      const dynamicVars = options.retell_llm_dynamic_variables || options.dynamic_variables || {};
      const stringifiedDynamicVars = {};
      for (const [key, value] of Object.entries(dynamicVars)) {
        stringifiedDynamicVars[key] = String(value);
      }

      const callPayload = {
        from_number: fromNumber, // Your imported Twilio number
        to_number: toNumber, // Target clinic phone
        override_agent_id: effectiveAgentId, // Use override_agent_id (recommended by Retell)
        retell_llm_dynamic_variables: stringifiedDynamicVars
      };

      // Add metadata if provided
      if (options.metadata) {
        callPayload.metadata = options.metadata;
      }

      // Also support legacy metadata structure at top level
      if (options.lead_id || options.clinic_name || options.call_type) {
        callPayload.metadata = {
          ...(callPayload.metadata || {}),
          lead_id: options.lead_id,
          clinic_name: options.clinic_name,
          call_type: options.call_type || 'sales_outbound'
        };
      }

      console.log(`📞 Creating outbound call via Retell API:`);
      console.log(`   From: ${fromNumber}`);
      console.log(`   To: ${toNumber}`);
      console.log(`   Agent ID: ${effectiveAgentId}`);
      if (callPayload.retell_llm_dynamic_variables && Object.keys(callPayload.retell_llm_dynamic_variables).length > 0) {
        console.log(`   Dynamic Variables:`, Object.keys(callPayload.retell_llm_dynamic_variables).join(', '));
      }

      const response = await axios.post(
        `${this.apiBaseUrl}/v2/create-phone-call`,
        callPayload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.data && response.data.call_id) {
        console.log(`✅ Outbound call created! Call ID: ${response.data.call_id}`);
        return {
          success: true,
          call_id: response.data.call_id,
          call_data: response.data
        };
      } else {
        throw new Error('Invalid response from Retell API: missing call_id');
      }
    } catch (error) {
      console.error('❌ Failed to create outbound call:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Response Data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to create outbound call: ${error.message}`);
    }
  }

  /**
   * Get a single call by ID
   * @param {string} callId
   * @returns {Promise<Object>}
   */
  async getCall(callId) {
    if (!this.apiKey) {
      throw new Error('RETELL_API_KEY not configured');
    }
    if (!callId) {
      throw new Error('callId is required');
    }
    const response = await axios.get(
      `${this.apiBaseUrl}/v2/get-call/${callId}`,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: 15000
      }
    );
    return response.data;
  }

  /**
   * List recent calls
   * @param {Object} params
   * @param {number} params.limit
   * @returns {Promise<Array>}
   */
  async listCalls(params = {}) {
    if (!this.apiKey) {
      throw new Error('RETELL_API_KEY not configured');
    }
    const response = await axios.get(
      `${this.apiBaseUrl}/v2/list-calls`,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        params: {
          limit: params.limit || 50
        },
        timeout: 15000
      }
    );
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.data?.calls)) return response.data.calls;
    if (Array.isArray(response.data?.data)) return response.data.data;
    return [];
  }

  /**
   * Create a web call access token for in-browser voice (Retell Web SDK)
   * @param {string} agentId - Retell agent ID
   * @param {Object} options - Optional: retell_llm_dynamic_variables, metadata
   * @returns {Promise<Object>} { access_token, call_type }
   */
  async createWebCall(agentId, options = {}) {
    if (!this.apiKey) {
      throw new Error('RETELL_API_KEY not configured');
    }
    if (!agentId) {
      throw new Error('Agent ID is required for web call');
    }
    try {
      const dynamicVars = options.retell_llm_dynamic_variables || options.dynamic_variables || {};
      const stringifiedDynamicVars = {};
      for (const [key, value] of Object.entries(dynamicVars)) {
        stringifiedDynamicVars[key] = String(value);
      }
      const payload = {
        agent_id: agentId,
        ...(Object.keys(stringifiedDynamicVars).length > 0 && { retell_llm_dynamic_variables: stringifiedDynamicVars }),
        ...(options.metadata && { metadata: options.metadata })
      };
      const response = await axios.post(
        `${this.apiBaseUrl}/v2/create-web-call`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );
      if (response.data && response.data.access_token) {
        return {
          success: true,
          access_token: response.data.access_token,
          call_type: response.data.call_type || 'web_call'
        };
      }
      throw new Error('Invalid Retell web call response');
    } catch (error) {
      console.error('❌ Failed to create web call token:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Response Data:', JSON.stringify(error.response.data, null, 2));
        const msg = error.response.data?.message || error.response.data?.error;
        if (error.response.status === 402 && msg) {
          throw new Error(`Retell billing: ${msg} Please check your Retell account at retellai.com.`);
        }
      }
      throw error;
    }
  }

  /**
   * Apply agent settings (best-effort placeholder)
   * @param {Object} options
   * @param {string} options.agentId
   * @param {boolean} options.enabled
   * @param {string} [options.greeting]
   * @param {Object} [options.business_hours]
   * @param {string} [options.after_hours_message]
   */
  async applyAgentSettings(options = {}) {
    const agentId = options.agentId || options.retell_agent_id;
    if (!agentId) {
      throw new Error('agentId is required to apply settings');
    }

    if (!this.apiKey) {
      console.warn('[RetellService] applyAgentSettings: RETELL_API_KEY not set; skipping Retell update.');
      return { success: false, warning: 'RETELL_API_KEY missing, skipped Retell update' };
    }

    // Build payload conservatively; Retell API may ignore unknown fields
    const payload = {};
    if (options.enabled !== undefined) {
      payload.enabled = !!options.enabled;
    }
    if (options.greeting !== undefined) {
      payload.greeting = options.greeting;
    }
    if (options.after_hours_message !== undefined) {
      payload.after_hours_message = options.after_hours_message;
    }
    if (options.business_hours !== undefined) {
      payload.business_hours = options.business_hours;
    }

    try {
      const resp = await axios.patch(
        `${this.apiBaseUrl}/v2/agents/${agentId}`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      console.log('[RetellService] applyAgentSettings: updated Retell agent', agentId);
      return { success: true, data: resp.data };
    } catch (error) {
      console.warn('[RetellService] applyAgentSettings: Retell update failed:', error.message);
      if (error.response) {
        console.warn(' Status:', error.response.status);
        console.warn(' Response:', JSON.stringify(error.response.data));
      }
      return { success: false, error: error.message };
    }
  }
}

module.exports = RetellService;
