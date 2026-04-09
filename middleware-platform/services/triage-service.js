/**
 * TRIAGE SERVICE (Phase 6.3)
 *
 * Red-flag detection for emergency symptom escalation.
 * Uses triage-rules.json when available; falls back to hardcoded patterns.
 */

const fs = require('fs');
const path = require('path');

const TRIAGE_RULES_PATH = path.resolve(__dirname, '../../Knowledge/rules/triage-rules.json');
let triageRules = { emergent: [], urgent: [], routine: [] };

try {
  if (fs.existsSync(TRIAGE_RULES_PATH)) {
    triageRules = JSON.parse(fs.readFileSync(TRIAGE_RULES_PATH, 'utf8'));
    const e = (triageRules.emergent || []).length;
    const u = (triageRules.urgent || []).length;
    if (e + u > 0) console.log(`✅ Loaded triage rules: ${e} emergent, ${u} urgent`);
  }
} catch (e) {
  console.warn('⚠️  Failed to load triage-rules.json:', e.message);
}

// Emergency red-flag phrases (fallback – any match → EMERGENT)
const EMERGENT_PATTERNS = [
  /\bchest\s+pain\b/i,
  /\bcrushing\s+(pain|pressure|discomfort)\b/i,
  /\bpain\s+(radiat|going)\s+to\s+(arm|jaw|back|neck)/i,
  /\bshortness?\s+of\s+breath\b/i,
  /\bcan'?t\s+breathe\b/i,
  /\bdifficulty\s+breathing\b/i,
  /\bstroke\b/i,
  /\bnumbness\s+in\s+(face|arm|leg)/i,
  /\bdrooping\s+face\b/i,
  /\bslurred\s+speech\b/i,
  /\bmeningitis\b/i,
  /\bunconscious\b/i,
  /\bchoking\b/i,
  /\bsevere\s+bleeding\b/i,
  /\bthoughts?\s+of\s+suicide\b/i,
  /\banaphylaxis\b/i,
  /\boverdose\b/i,
  /\bseizure\b/i,
  /\bactive\s+seizure\b/i
];

const URGENT_PATTERNS = [
  /\bhigh\s+fever\s+(102|103|104|105)/i,
  /\bsevere\s+pain\b/i,
  /\bpossible\s+fracture\b/i,
  /\bbroken\s+(bone|arm|leg)\b/i,
  /\bcan'?t\s+stop\s+vomiting\b/i
];

const EMERGENT_RESPONSE = 'This sounds like a medical emergency. Please call 911 or go to the nearest emergency room immediately. Do not delay.';
const URGENT_RESPONSE = 'These symptoms may require same-day or urgent care. Please consider visiting an urgent care center or emergency room.';

function _isNegatedMention(text, matchedPhrase) {
  const t = String(text || '').toLowerCase();
  const p = String(matchedPhrase || '').toLowerCase().trim();
  if (!t || !p) return false;
  const idx = t.indexOf(p);
  if (idx < 0) return false;
  const before = t.slice(Math.max(0, idx - 36), idx);
  return /\b(no|denies|without|not|never)\s+$/.test(before) ||
    /\b(no|denies|without|not|never)\s+(any\s+)?[\w\s]{0,24}$/.test(before) ||
    /\b(can't|cannot|dont|don't|do not)\s+have\s+[\w\s]{0,20}$/.test(before);
}

function matchesRule(text, rule) {
  const t = text.toLowerCase();
  const patterns = rule.patterns || rule.symptoms || [];
  if (patterns.length === 0) return false;

  const matchMode = (rule.match_mode || 'any_1').toLowerCase();
  let matchCount = 0;

  for (const p of patterns) {
    const pat = typeof p === 'string' ? p : String(p);
    if (pat.includes('[') || pat.includes('(')) {
      try {
        const re = new RegExp(pat, 'i');
        const m = text.match(re);
        if (m && !_isNegatedMention(text, m[0])) matchCount++;
      } catch (e) {
        if (t.includes(pat.toLowerCase()) && !_isNegatedMention(text, pat)) matchCount++;
        else console.warn('[triage] regex match failed:', e.message);
      }
    } else if (t.includes(pat.toLowerCase()) && !_isNegatedMention(text, pat)) {
      matchCount++;
    }
  }

  if (matchMode === 'any_1' && matchCount >= 1) return true;
  if (matchMode === 'any_2_of_symptoms' && matchCount >= 2) return true;
  if (matchMode === 'any_2_or_throat_swelling') {
    if (matchCount >= 2) return true;
    if (t.includes('throat') && t.includes('swell')) return true;
  }
  // meningitis: need stiff neck + headache, or all 3 - "fever" alone must NOT match
  if (matchMode === 'all_3_or_headache_stiff') {
    const hasStiff = t.includes('stiff') && t.includes('neck');
    const hasHeadache = t.includes('headache') || t.includes('meningitis');
    if (matchCount >= 3 || (hasStiff && hasHeadache)) return true;
  }

  return false;
}

function detectRedFlagsFromRules(text) {
  const emergent = triageRules.emergent || [];
  const urgent = triageRules.urgent || [];

  for (const rule of emergent) {
    if (rule.match_mode === 'fallback') continue;
    if (matchesRule(text, rule)) {
      const matched = (rule.patterns || []).find(p => text.toLowerCase().includes(String(p).toLowerCase()));
      return {
        isEmergency: true,
        urgency: 'EMERGENT',
        redFlags: [matched || rule.id || 'emergency'],
        suggestedResponse: rule.rationale || EMERGENT_RESPONSE,
        ruleId: rule.id
      };
    }
  }

  for (const rule of urgent) {
    if (rule.match_mode === 'fallback') continue;
    if (matchesRule(text, rule)) {
      const matched = (rule.patterns || []).find(p => text.toLowerCase().includes(String(p).toLowerCase()));
      return {
        isEmergency: false,
        urgency: 'URGENT',
        redFlags: [matched || rule.id || 'urgent'],
        suggestedResponse: rule.rationale || URGENT_RESPONSE,
        ruleId: rule.id
      };
    }
  }

  return null;
}

function detectRedFlags(text) {
  const t = (text || '').toString().trim();
  if (!t) return { isEmergency: false, urgency: 'ROUTINE', redFlags: [], suggestedResponse: '' };

  const ruleResult = detectRedFlagsFromRules(t);
  if (ruleResult) return ruleResult;

  const redFlags = [];
  for (const re of EMERGENT_PATTERNS) {
    if (re.test(t)) {
      const m = t.match(re);
      const phrase = (m && m[0]) || 'emergency indicator';
      if (!_isNegatedMention(t, phrase)) redFlags.push(phrase);
    }
  }
  if (redFlags.length > 0) {
    return {
      isEmergency: true,
      urgency: 'EMERGENT',
      redFlags: [...new Set(redFlags)],
      suggestedResponse: EMERGENT_RESPONSE
    };
  }

  for (const re of URGENT_PATTERNS) {
    if (re.test(t)) {
      const m = t.match(re);
      const phrase = (m && m[0]) || 'urgent indicator';
      if (!_isNegatedMention(t, phrase)) redFlags.push(phrase);
    }
  }
  if (redFlags.length > 0) {
    return {
      isEmergency: false,
      urgency: 'URGENT',
      redFlags: [...new Set(redFlags)],
      suggestedResponse: URGENT_RESPONSE
    };
  }

  return { isEmergency: false, urgency: 'ROUTINE', redFlags: [], suggestedResponse: '' };
}

function checkBeforeScheduling(recentTurns = []) {
  const combined = recentTurns
    .filter(t => t.role === 'user' && t.content)
    .map(t => t.content)
    .join(' ');
  const assessment = detectRedFlags(combined);
  return {
    blockScheduling: assessment.isEmergency,
    assessment
  };
}

/** Export loaded rules for shared use (orch-16) */
function getTriageRules() {
  return triageRules;
}

module.exports = {
  detectRedFlags,
  checkBeforeScheduling,
  getTriageRules,
  EMERGENT_RESPONSE,
  URGENT_RESPONSE
};
