'use strict';

/** Voice vs back-office RAG latency/HyDE settings (Phase 6.2 / 6.4). */

const VOICE_REMOTE_RAG_TIMEOUT_MS = parseInt(process.env.VOICE_REMOTE_RAG_TIMEOUT_MS || '2000', 10);
const DEFAULT_REMOTE_RAG_TIMEOUT_MS = parseInt(process.env.REMOTE_RAG_TIMEOUT_MS || '8000', 10);

function isVoiceChannel(channel) {
  return String(channel || '').trim().toLowerCase() === 'voice';
}

function resolveRagRuntimeOptions(channelOrOpts = 'chat') {
  const channel =
    typeof channelOrOpts === 'object'
      ? channelOrOpts.channel || channelOrOpts.source || 'chat'
      : channelOrOpts;
  const voice = isVoiceChannel(channel);
  return {
    channel: voice ? 'voice' : 'chat',
    hydeEnabled: voice
      ? false
      : String(process.env.TRIAGE_HYDE_ENABLED ?? '1').trim() !== '0',
    remoteTimeoutMs: voice ? VOICE_REMOTE_RAG_TIMEOUT_MS : DEFAULT_REMOTE_RAG_TIMEOUT_MS
  };
}

module.exports = {
  VOICE_REMOTE_RAG_TIMEOUT_MS,
  DEFAULT_REMOTE_RAG_TIMEOUT_MS,
  isVoiceChannel,
  resolveRagRuntimeOptions
};
