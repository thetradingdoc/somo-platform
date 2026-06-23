/**
 * PromptBuilder
 *
 * Compiles the final system prompt used by AgentBrainService.
 * Combines:
 * - Base system prompt (non-overridable safety + role)
 * - Clinic-level configuration (prompt profile)
 * - Conversation state
 * - Session context (clinic name, channel, etc.)
 */

const crypto = require('crypto');

class PromptBuilder {
  build({ basePrompt, clinicPromptText, channel, clinicName, state }) {
    const sections = [];
    sections.push(basePrompt);

    const channelNote =
      channel === 'voice'
        ? 'Channel: Phone call. Keep responses short (1–2 sentences) and easy to say aloud.'
        : channel === 'video'
        ? 'Channel: Video consult assistant. You may be slightly more verbose, but still concise.'
        : 'Channel: Chat. You can be a bit more detailed, but stay focused.';

    sections.push('');
    sections.push(channelNote);

    if (state) {
      sections.push('');
      sections.push(`Conversation state: ${state}`);
    }

    const clinicLines = [];
    if (clinicName) {
      clinicLines.push(`Clinic name: ${clinicName}`);
    }
    if (clinicPromptText) {
      clinicLines.push('');
      clinicLines.push('Clinic-specific instructions:');
      clinicLines.push(clinicPromptText);
    }
    if (clinicLines.length > 0) {
      sections.push('');
      sections.push(clinicLines.join('\n'));
    }

    return sections.join('\n');
  }

  checksum(promptText) {
    if (!promptText) return '';
    return crypto.createHash('sha256').update(promptText, 'utf8').digest('hex');
  }
}

module.exports = new PromptBuilder();

