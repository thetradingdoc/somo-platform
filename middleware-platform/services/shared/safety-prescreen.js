const { detectRedFlags } = require('../clinical/triage-service');

function _visionRisk(payload) {
  const detections = payload?.detections || payload?.yolo_detections || [];
  if (!Array.isArray(detections) || detections.length === 0) return null;
  const high = detections.find((d) => Number(d?.confidence || d?.conf || 0) >= 0.85);
  if (!high) return null;
  return {
    level: 'caution',
    reason: 'high_confidence_vision_signal',
    flags: [{ rule_id: 'vision_high_confidence', level: 'caution', match_snippet: String(high?.class || high?.name || 'unknown') }]
  };
}

function evaluateSafety({ text = '', eventType = 'chat_turn', payload = {}, roomId = null, seenRules = [] } = {}) {
  const fromText = detectRedFlags(String(text || ''));
  if (fromText?.isEmergency) {
    return {
      status: 'red',
      emergency: true,
      reason: 'text_red_flag',
      suggested_response: fromText.suggestedResponse || null,
      flags: [{ rule_id: 'text_red_flag', level: 'emergent', match_snippet: String(text || '').slice(0, 180) }]
    };
  }

  if (eventType === 'vision_frame') {
    const vision = _visionRisk(payload);
    if (vision) return { status: 'yellow', emergency: false, ...vision };
  }

  return {
    status: 'green',
    emergency: false,
    reason: 'no_red_flags',
    flags: []
  };
}

module.exports = {
  evaluateSafety
};
