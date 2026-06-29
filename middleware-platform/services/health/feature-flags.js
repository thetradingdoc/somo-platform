'use strict';

function flag(name, defaultValue = false) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return defaultValue;
  return v === '1' || String(v).toLowerCase() === 'true' || v === 'yes';
}

module.exports = {
  ragEnabled: () => flag('HEALTH_RAG_ENABLED', flag('DERM_EDUCATION_PIPELINE_ENABLED', false)),
  visionEnabled: () => flag('HEALTH_VISION_ENABLED', true),
  browserSttOnly: () => flag('HEALTH_BROWSER_STT_ONLY', true),
  anthropicVision: () => flag('HEALTH_VISION_ANTHROPIC_ENABLED', false),
  serverSttEnabled: () => flag('HEALTH_SERVER_STT_ENABLED', false),
  ttsEnabled: () => flag('HEALTH_TTS_ENABLED', false)
};
