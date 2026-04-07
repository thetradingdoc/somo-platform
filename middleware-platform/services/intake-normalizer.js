const Metrics = require('./metrics');

function _toString(v) {
  return String(v || '').trim();
}

function _pickText(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  return _toString(p.message || p.text || p.content || p.transcript || '');
}

function _extractSimpleFields(text) {
  const t = _toString(text).toLowerCase();
  if (!t) {
    return {
      chief_complaint: null,
      body_sites: [],
      severity: null,
      timeline: null,
      risk_flags: []
    };
  }
  const symptomMatch = t.match(/\b(rash|pain|itch|itching|burn|redness|swelling|fever|acne|eczema|psoriasis)\b/);
  const siteMatches = t.match(/\b(face|neck|arm|leg|back|chest|scalp|skin|hands|feet|shoulder|abdomen)\b/g) || [];
  const severityNum = (() => {
    const m = t.match(/\b([0-9]|10)\s*\/\s*10\b/) || t.match(/\bseverity\s*(?:is|=)?\s*([0-9]|10)\b/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  })();
  const timeline = (() => {
    const m =
      t.match(/\b(for|since)\s+([a-z0-9\s-]{1,40})\b/) ||
      t.match(/\b(today|yesterday|last night|this morning|weeks?|months?|years?)\b/);
    return m ? _toString(m[0]) : null;
  })();
  const riskFlags = [];
  if (/\b(can't breathe|cannot breathe|shortness of breath|chest pain)\b/.test(t)) riskFlags.push('respiratory_or_chest_red_flag');
  if (/\b(bleeding|passed out|fainted|stroke)\b/.test(t)) riskFlags.push('acute_medical_red_flag');
  if (/\b(suicidal|kill myself|self-harm)\b/.test(t)) riskFlags.push('behavioral_health_red_flag');

  return {
    chief_complaint: symptomMatch ? symptomMatch[1] : null,
    body_sites: [...new Set(siteMatches)],
    severity: severityNum,
    timeline,
    risk_flags: riskFlags,
    has_symptom_language: /\b(rash|pain|itch|itching|burn|redness|swelling|fever|acne|eczema|psoriasis)\b/.test(t),
    mentions_body_site: /\b(face|neck|arm|leg|back|chest|scalp|skin|hands|feet)\b/.test(t),
    possible_urgency_signal: /\b(emergency|urgent|severe|can't breathe|chest pain|bleeding)\b/.test(t)
  };
}

function normalizeIntakeEvent(envelope) {
  try {
    const source = _toString(envelope?.source || 'unknown');
    const eventType = _toString(envelope?.event_type || 'unknown');
    const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
    const text = _pickText(payload);

    let normalizedType = 'unknown';
    if (eventType === 'chat_turn') normalizedType = 'chat_text';
    else if (eventType === 'transcript') normalizedType = 'transcript_text';
    else if (eventType === 'vision_frame') normalizedType = 'vision_signal';
    else if (eventType === 'end_session') normalizedType = 'session_control';
    else if (eventType === 'document_upload' || eventType === 'upload') normalizedType = 'document_signal';

    const out = {
      normalized_type: normalizedType,
      source,
      event_type: eventType,
      session_id: envelope?.session_id || null,
      room_id: envelope?.room_id || null,
      text: text || null,
      fields: _extractSimpleFields(text),
      payload_ref: {
        has_payload: payload && Object.keys(payload).length > 0
      }
    };

    if (eventType === 'vision_frame') {
      const detections = payload?.detections || payload?.yolo_detections || [];
      out.vision = {
        detection_count: Array.isArray(detections) ? detections.length : 0,
        classes: Array.isArray(detections)
          ? detections
              .map((d) => _toString(d?.class || d?.name || ''))
              .filter(Boolean)
              .slice(0, 20)
          : []
      };
    }

    if (normalizedType === 'document_signal') {
      out.document = {
        file_name: _toString(payload?.file_name || payload?.name || ''),
        mime_type: _toString(payload?.mime_type || payload?.content_type || ''),
        has_text: !!_pickText(payload)
      };
    }

    Metrics.increment('intake_normalizer.success_total', 1);
    return out;
  } catch (e) {
    Metrics.increment('intake_normalizer.failure_total', 1);
    throw e;
  }
}

module.exports = {
  normalizeIntakeEvent
};
