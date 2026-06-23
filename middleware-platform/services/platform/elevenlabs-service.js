/**
 * ElevenLabs Conversational AI Service
 * Fetches signed URLs for in-browser voice conversations (demo alternative to Retell)
 */

const axios = require('axios');

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

class ElevenLabsService {
  constructor() {
    const raw = process.env.ELEVENLABS || process.env.ELEVENLABS_API_KEY;
    this.apiKey = typeof raw === 'string' ? raw.trim() : raw;
    this.agentId = process.env.ELEVENLABS_AGENT_ID;
    this._agentsCache = null;
  }

  _headers() {
    return {
      'xi-api-key': this.apiKey,
      'Content-Type': 'application/json'
    };
  }

  /**
   * List agents - used to pick first agent if ELEVENLABS_AGENT_ID not set
   */
  async listAgents() {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key not configured. Set ELEVENLABS or ELEVENLABS_API_KEY in .env');
    }
    try {
      const { data } = await axios.get(`${ELEVENLABS_API}/convai/agents`, {
        headers: this._headers(),
        params: { page_size: 10 }
      });
      return data.agents || [];
    } catch (err) {
      if (err.response?.status === 401) {
        const detail = err.response?.data?.detail;
        if (detail?.status === 'missing_permissions') {
          throw new Error(
            `ElevenLabs API key missing permission: ${detail.message || 'convai_read'}. Create a new key at elevenlabs.io with Conversational AI access.`
          );
        }
        throw new Error(
          'ElevenLabs API key invalid or expired. Check ELEVENLABS in .env and get a valid key at elevenlabs.io/app/settings/api-keys'
        );
      }
      throw err;
    }
  }

  /**
   * Get agent ID - use env var or first agent from account
   */
  async getAgentId() {
    if (this.agentId) return this.agentId;
    if (this._agentsCache && this._agentsCache.length > 0) {
      return this._agentsCache[0].agent_id;
    }
    const agents = await this.listAgents();
    this._agentsCache = agents;
    if (!agents.length) {
      throw new Error(
        'No ElevenLabs Conversational AI agents found. Create one at https://elevenlabs.io/app/conversational-ai and optionally set ELEVENLABS_AGENT_ID in .env'
      );
    }
    const first = agents[0];
    return first.agent_id || first.id;
  }

  /**
   * Get signed URL for a voice conversation session
   * Client uses this to connect to ElevenLabs WebSocket without exposing API key
   */
  async getSignedUrl(options = {}) {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key not configured. Set ELEVENLABS or ELEVENLABS_API_KEY in .env');
    }

    const agentId = options.agentId || await this.getAgentId();

    try {
      const { data } = await axios.get(`${ELEVENLABS_API}/convai/conversation/get-signed-url`, {
        headers: this._headers(),
        params: {
          agent_id: agentId,
          include_conversation_id: options.includeConversationId ?? false
        }
      });

      if (!data.signed_url) {
        throw new Error('ElevenLabs did not return a signed URL');
      }

      return {
        signed_url: data.signed_url,
        agent_id: agentId
      };
    } catch (err) {
      if (err.response?.status === 401) {
        const detail = err.response?.data?.detail;
        if (detail?.status === 'missing_permissions') {
          throw new Error(
            `ElevenLabs API key missing permission: ${detail.message || 'convai_read'}. Create a new key at elevenlabs.io with Conversational AI access.`
          );
        }
        throw new Error(
          'ElevenLabs API key invalid or expired. Check ELEVENLABS in .env and get a valid key at elevenlabs.io/app/settings/api-keys'
        );
      }
      if (err.response?.status === 403) {
        throw new Error(
          'ElevenLabs API key does not have Conversational AI access. Check your subscription at elevenlabs.io'
        );
      }
      throw err;
    }
  }
}

module.exports = ElevenLabsService;
