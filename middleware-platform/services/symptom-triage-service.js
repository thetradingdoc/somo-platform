/**
 * Symptom Triage Service
 * Server-side risk detection from transcript text.
 * High-sensitivity regex for emergencies; idempotent per session.
 */

const { RISK_LEVELS, buildRiskPayload } = require('./video-consult-sse-schema');

const RULES = [
  { id: 'chest_pain', regex: /\b(chest pain|pressure in my chest|tightness in chest|chest pressure)\b/i, level: RISK_LEVELS.HIGH },
  { id: 'sob', regex: /\b(shortness of breath|can't breathe|difficulty breathing|struggling to breathe)\b/i, level: RISK_LEVELS.HIGH },
  { id: 'suicidal', regex: /\b(kill myself|suicidal|want to die|end my life)\b/i, level: RISK_LEVELS.HIGH },
  { id: 'stroke', regex: /\b(sudden weakness|face drooping|can't smile|arm weakness|speech difficulty)\b/i, level: RISK_LEVELS.HIGH },
  { id: 'fever', regex: /\b(fever|temperature of|hot and shivery|high temp)\b/i, level: RISK_LEVELS.MODERATE },
  { id: 'allergic_reaction', regex: /\b(swelling of throat|can't swallow|hives all over|anaphylaxis)\b/i, level: RISK_LEVELS.HIGH }
];

/**
 * Run risk detection on transcript text.
 * @param {string} text - Transcript snippet
 * @param {string} roomId - Room ID for dedupe key
 * @param {Set<string>} [seenRuleIds] - Rules already triggered this session (for idempotency)
 * @returns {{ level: string, flags: Array, rule_ids: string[], alert_dedupe_key: string|null, transcript_ids?: string[] }|null}
 */
function detectRisk(text, roomId, seenRuleIds = new Set()) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.length) return null;

  const flags = [];
  const ruleIds = [];
  let maxLevel = RISK_LEVELS.LOW;

  for (const rule of RULES) {
    if (seenRuleIds.has(rule.id)) continue;
    const match = trimmed.match(rule.regex);
    if (match) {
      flags.push({ rule_id: rule.id, level: rule.level, match_snippet: (match[0] || '').slice(0, 40) });
      ruleIds.push(rule.id);
      if (rule.level === RISK_LEVELS.HIGH) maxLevel = RISK_LEVELS.HIGH;
      else if (rule.level === RISK_LEVELS.MODERATE && maxLevel !== RISK_LEVELS.HIGH) maxLevel = RISK_LEVELS.MODERATE;
    }
  }

  if (flags.length === 0) return null;

  return buildRiskPayload(maxLevel, flags, {
    rule_ids: ruleIds,
    alert_dedupe_key: roomId && ruleIds.length ? `${roomId}:${ruleIds[0]}` : null
  });
}

/**
 * Get rules that were triggered (for idempotency tracking).
 */
function getTriggeredRuleIds(text) {
  if (!text || typeof text !== 'string') return [];
  const ids = [];
  for (const rule of RULES) {
    if (rule.regex.test(text.trim())) ids.push(rule.id);
  }
  return ids;
}

module.exports = {
  detectRisk,
  getTriggeredRuleIds,
  RULES
};
