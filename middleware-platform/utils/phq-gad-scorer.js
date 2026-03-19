/**
 * PHQ-2 and GAD-2 scoring utilities (M-S1.B)
 * Kelly asks the questions; these compute scores from answers.
 *
 * PHQ-2: "Over the past 2 weeks, have you felt little interest or pleasure in doing things?"
 *        "Over the past 2 weeks, have you felt down, depressed, or hopeless?"
 * Each yes = 1, no = 0. Score 0-2.
 *
 * GAD-2: "Over the past 2 weeks, have you felt nervous, anxious, or on edge?"
 *        "Over the past 2 weeks, have you been unable to stop or control worrying?"
 * Each yes = 1, no = 0. Score 0-2.
 */

const YES_PATTERNS = [
  /\b(yes|yeah|yep|yup|absolutely|definitely|often|sometimes|a bit)\b/i,
  /\b(true|1|affirmative)\b/i
];
const NO_PATTERNS = [/\b(no|nope|nah|not really|never|rarely)\b/i];

function isYes(val) {
  if (val == null || val === '') return null;
  const s = String(val).toLowerCase().trim();
  if (YES_PATTERNS.some(p => p.test(s))) return true;
  if (NO_PATTERNS.some(p => p.test(s))) return false;
  if (/^(1|true|yes)$/i.test(s)) return true;
  if (/^(0|false|no)$/i.test(s)) return false;
  return null;
}

/**
 * Score PHQ-2 from two answers.
 * @param {Object} answers - { q1?: string, q2?: string } or [string, string]
 * @returns {number|null} 0–2 or null if unscoreable
 */
function scorePHQ2(answers) {
  const a = Array.isArray(answers) ? answers : [answers?.q1, answers?.q2];
  const b1 = isYes(a[0]);
  const b2 = isYes(a[1]);
  if (b1 === null && b2 === null) return null;
  let score = 0;
  if (b1 === true) score++;
  if (b2 === true) score++;
  return score;
}

/**
 * Score GAD-2 from two answers.
 * @param {Object} answers - { q1?: string, q2?: string } or [string, string]
 * @returns {number|null} 0–2 or null if unscoreable
 */
function scoreGAD2(answers) {
  const a = Array.isArray(answers) ? answers : [answers?.q1, answers?.q2];
  const b1 = isYes(a[0]);
  const b2 = isYes(a[1]);
  if (b1 === null && b2 === null) return null;
  let score = 0;
  if (b1 === true) score++;
  if (b2 === true) score++;
  return score;
}

module.exports = { scorePHQ2, scoreGAD2, isYes };
