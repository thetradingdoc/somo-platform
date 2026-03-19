/**
 * TriageRAGService
 *
 * Extends the existing knowledge-service RAG output with:
 *   - target_specialty   (for SpecialistResolver)
 *   - safety_level       (Red / Yellow / Green — gates the Golden Path)
 *   - urgency            (emergent / urgent / routine)
 *   - patient_friendly_summary (for Kelly to narrate)
 *
 * Also handles the OPQRST → RAG pipeline:
 * structured clinical intake → enriched RAG query → resolver-ready output
 *
 * Usage:
 *   const result = await TriageRAGService.enrichFromSymptoms({ sessionId, symptomText, opqrst });
 *   if (result.safety_level === 'red') → 911 path
 *   else → SpecialistResolverService.resolve({ specialty: result.target_specialty, urgency: result.urgency })
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { normalizeForRAG } = require('../utils/signal-analysis');

const DIFFERENTIAL_SYSTEM_PROMPT = `You are a clinical triage assistant. Given RAG-retrieved ICD codes and a clinical history, generate the top 3 most likely differential diagnoses.

Return a JSON array of objects, each with exactly these fields (use null for unknown):
- condition: string (condition name)
- icd10: string (primary ICD-10 code)
- coverage_pct: number 0-100 (how much of the presentation this explains)
- mechanism: string (brief pathophysiologic mechanism)
- supporting_evidence: string (what from history supports this)
- evidence_against: string (what argues against)
- discriminating_test: string (test that would help rule in/out)
- confidence_cap_reason: string | null (e.g. "alcohol history unknown" if CAGE not done and liver dx possible)

Be concise. Output ONLY the JSON array, no markdown.`;

// ─────────────────────────────────────────────────────────────────
// Specialty map: ICD chapter/prefix → specialty
// ─────────────────────────────────────────────────────────────────
const ICD_SPECIALTY_MAP = [
  { prefix: 'F', specialty: 'Psychiatry' },
  { prefix: 'I', specialty: 'Cardiology' },
  { prefix: 'J', specialty: 'Pulmonology' },
  { prefix: 'M', specialty: 'Orthopedics' },
  { prefix: 'G', specialty: 'Neurology' },
  { prefix: 'L', specialty: 'Dermatology' },
  { prefix: 'K', specialty: 'Gastroenterology' },
  { prefix: 'E', specialty: 'Endocrinology' },
  { prefix: 'N', specialty: 'Urology' },
  { prefix: 'H0', specialty: 'Ophthalmology' },
  { prefix: 'H1', specialty: 'Ophthalmology' },
  { prefix: 'H2', specialty: 'Ophthalmology' },
  { prefix: 'H3', specialty: 'Ophthalmology' },
  { prefix: 'H4', specialty: 'Ophthalmology' },
  { prefix: 'H5', specialty: 'Ophthalmology' },
  { prefix: 'H6', specialty: 'ENT' },
  { prefix: 'H7', specialty: 'ENT' },
  { prefix: 'H8', specialty: 'ENT' },
  { prefix: 'H9', specialty: 'ENT' },
  { prefix: 'A', specialty: 'InfectiousDisease' },
  { prefix: 'B', specialty: 'InfectiousDisease' },
  { prefix: 'C', specialty: 'Oncology' },
  { prefix: 'O', specialty: 'ObstetricsGynecology' },
  { prefix: 'P', specialty: 'Pediatrics' },
  { prefix: 'S', specialty: 'EmergencyMedicine' },
  { prefix: 'T', specialty: 'EmergencyMedicine' },
];

// ─────────────────────────────────────────────────────────────────
// Keyword-to-specialty overrides
// ─────────────────────────────────────────────────────────────────
const SYMPTOM_SPECIALTY_KEYWORDS = [
  { keywords: ['heart', 'chest pain', 'chest tightness', 'fluttery', 'palpitation', 'arrhythmia', 'ecg', 'ekg'], specialty: 'Cardiology', urgency_boost: true },
  { keywords: ['rash', 'skin', 'acne', 'eczema', 'psoriasis', 'lesion', 'mole', 'hives'], specialty: 'Dermatology' },
  { keywords: ['anxiety', 'depression', 'mood', 'mental', 'panic', 'ptsd', 'adhd', 'bipolar', 'suicidal'], specialty: 'Psychiatry' },
  { keywords: ['therapy', 'therapist', 'counseling', 'psychotherapy', 'psychiatrist'], specialty: 'Psychiatry' },
  { keywords: ['knee', 'back pain', 'joint', 'fracture', 'sprain', 'torn', 'ligament', 'tendon'], specialty: 'Orthopedics' },
  { keywords: ['headache', 'migraine', 'seizure', 'numbness', 'dizziness', 'stroke', 'tremor'], specialty: 'Neurology', urgency_boost: true },
  { keywords: ['breath', 'asthma', 'copd', 'cough', 'wheeze', 'pneumonia'], specialty: 'Pulmonology' },
  { keywords: ['stomach', 'nausea', 'vomiting', 'diarrhea', 'ibs', 'reflux', 'crohn', 'colitis'], specialty: 'Gastroenterology' },
  { keywords: ['diabetes', 'thyroid', 'hormone', 'insulin', 'blood sugar'], specialty: 'Endocrinology' },
  { keywords: ['checkup', 'routine', 'physical', 'general', 'primary care'], specialty: 'PrimaryCare' },
  { keywords: ['child', 'baby', 'infant', 'pediatric', 'kid', 'toddler'], specialty: 'Pediatrics' },
  { keywords: ['pregnant', 'pregnancy', 'ob', 'gynecology', 'period', 'ovarian'], specialty: 'ObstetricsGynecology' },
];

// ─────────────────────────────────────────────────────────────────
// Red flag patterns → safety_level = 'red' → 911 bypass
// ─────────────────────────────────────────────────────────────────
const RED_FLAG_PATTERNS = [
  /\b(crushing|severe)\b.*\b(chest pain|chest pressure)\b/i,
  /\bcan't breathe\b|\bcannot breathe\b|\bshortness of breath\b.*\bsevere\b/i,
  /\bstroke\b|\bface drooping\b|\barm weakness\b|\bspeech\b.*\bsuddenly\b/i,
  /\bsuicid(al|e)\b|\bkill myself\b|\bend my life\b/i,
  /\bsevere\b.*\bbleeding\b|\bhemorrhage\b/i,
  /\bunconscious\b|\bseizure\b.*\bactive\b|\bnot waking\b/i,
  /\bpoisoned\b|\boverdose\b|\btook too many\b/i,
  /\bsevere\b.*\ballergic\b|\banaphylaxis\b|\bthroat.*swelling\b/i,
];

// ─────────────────────────────────────────────────────────────────
// W2-S3.2 / M-S3.A: Differential → specialty (≥14 conditions)
// ─────────────────────────────────────────────────────────────────
const DIFFERENTIAL_SPECIALTY_MAP = {
  // Gastroenterology
  'NASH': 'Gastroenterology',
  'nash': 'Gastroenterology',
  'Alcoholic hepatitis': 'Gastroenterology',
  'alcoholic hepatitis': 'Gastroenterology',
  'Autoimmune hepatitis': 'Gastroenterology',
  'autoimmune hepatitis': 'Gastroenterology',
  // Endocrinology
  'Prolactinoma': 'Endocrinology',
  'prolactinoma': 'Endocrinology',
  'Hypothyroidism': 'Endocrinology',
  'hypothyroidism': 'Endocrinology',
  'Diabetes': 'Endocrinology',
  'diabetes': 'Endocrinology',
  'Type 2 diabetes': 'Endocrinology',
  'Type 1 diabetes': 'Endocrinology',
  // Pulmonology
  'COPD': 'Pulmonology',
  'copd': 'Pulmonology',
  'Asthma': 'Pulmonology',
  'asthma': 'Pulmonology',
  // Cardiology
  'MI': 'Cardiology',
  'Myocardial infarction': 'Cardiology',
  'Arrhythmia': 'Cardiology',
  'arrhythmia': 'Cardiology',
  'Atrial fibrillation': 'Cardiology',
  // Psychiatry
  'MDD': 'Psychiatry',
  'Major depressive disorder': 'Psychiatry',
  'major depressive disorder': 'Psychiatry',
  'GAD': 'Psychiatry',
  'Generalized anxiety disorder': 'Psychiatry',
  'PTSD': 'Psychiatry',
  'post-traumatic stress disorder': 'Psychiatry',
  // Infectious Disease
  'Sepsis': 'InfectiousDisease',
  'sepsis': 'InfectiousDisease',
  'TB': 'InfectiousDisease',
  'Tuberculosis': 'InfectiousDisease',
  'tuberculosis': 'InfectiousDisease',
  'HIV': 'InfectiousDisease',
  'hiv': 'InfectiousDisease'
};

// Yellow flag patterns → urgency = 'urgent'
const YELLOW_FLAG_PATTERNS = [
  /\bhigh fever\b|\btemperature over 104\b|\b40°c\b/i,
  /\bchest pain\b(?!.*crushing)(?!.*severe)/i,
  /\bbreath\b.*\bshort\b|\bshort\b.*\bbreath\b/i,
  /\bblood\b.*\b(urine|stool|cough)\b|\bcoughing blood\b/i,
  /\bnumbness\b|\bweakness\b.*\bsudden\b/i,
  /\bconfused\b|\bdisoriented\b/i,
];

class TriageRAGService {
  /**
   * Main enrichment method.
   *
   * @param {Object} params
   * @param {string} params.sessionId
   * @param {string} params.symptomText
   * @param {Object} [params.opqrst]
   * @param {string} [params.patientId]
   * @param {string} [params.clinicId]
   * @returns {Promise<TriageRAGResult>}
   */
  static async enrichFromSymptoms({ sessionId, symptomText, opqrst = {}, richIntake = {}, patientId = null, clinicId = null, _ragResultOverride = null }) {
    let combinedText = this._buildCombinedText(symptomText, opqrst, richIntake);
    combinedText = normalizeForRAG(combinedText);

    let { safetyLevel, urgency, redFlags } = this._assessSafety(combinedText, opqrst);
    // Bug 5: Normalize raw answer text — LLM may pass "yes I have" instead of "positive"
    const safetyScreenNorm = (richIntake.safety_screen || '').toLowerCase().trim();
    if (safetyScreenNorm === 'positive' || /\b(yes|yeah|true)\b/.test(safetyScreenNorm)) {
      safetyLevel = 'red';
      urgency = 'emergent';
      redFlags = [...(redFlags || []), 'Safety screen positive'];
    }

    let icdCodes = [];
    let cptCodes = [];
    if (_ragResultOverride) {
      // Bug 1: Normalize to { code, description, confidence } — downstream expects objects
      const rawIcd = _ragResultOverride.icdCodes || _ragResultOverride.icd10 || [];
      icdCodes = rawIcd.map(c => typeof c === 'string' ? { code: c, description: '', confidence: 0.8 } : c);
      const rawCpt = _ragResultOverride.cptCodes || _ragResultOverride.cpt || [];
      cptCodes = rawCpt.map(c => typeof c === 'string' ? { code: c, description: '', confidence: 0.8 } : c);
    } else {
      try {
        const knowledgeService = require('./knowledge-service');
        const ragResult = await knowledgeService.getCodeCandidates(combinedText, {
          maxIcd10: 5,
          maxCpt: 3,
          clinicId,
          callId: sessionId
        });
        icdCodes = ragResult?.icd10 || [];
        cptCodes = ragResult?.cpt || [];
      } catch (e) {
        console.warn('[TriageRAG] knowledge-service unavailable, using keyword matching only:', e.message);
      }
    }

    // W2-S3.1/S3.4: Generate differentials; drive specialty from primary (W2-S3.3)
    const ragChunks = [...(icdCodes || []), ...(cptCodes || []).map(c => ({ code: c.code, description: c.description }))];
    let differentials = await this._generateDifferentials(ragChunks, combinedText, richIntake);
    let specialty;
    let secondarySpecialties;

    // W2-S2.4: Specialty from differential generation, not ICD prefix alone. ICD only when differentials empty.
    if (differentials && differentials.length > 0) {
      const prim = differentials[0];
      specialty = this._specialtyFromDifferential(prim.condition) || this._resolveSpecialty(combinedText, icdCodes).specialty;
      const specs = new Set();
      for (const d of differentials.slice(1)) {
        const s = this._specialtyFromDifferential(d.condition);
        if (s && s !== specialty) specs.add(s);
      }
      secondarySpecialties = Array.from(specs);
      // W3-S4.1: Primary ICD-10 = differential #1's icd10; put it first for billing
      if (prim.icd10 && prim.icd10.trim()) {
        const existing = (icdCodes || []).filter(c => (c.code || '').trim() !== prim.icd10.trim());
        icdCodes = [{ code: prim.icd10.trim(), description: prim.condition || '', confidence: 0.95 }, ...existing];
      }
    } else {
      const resolved = this._resolveSpecialty(combinedText, icdCodes);
      specialty = resolved.specialty;
      secondarySpecialties = resolved.secondarySpecialties;
    }

    // M-S3.B: Confidence cap when alcohol_cage_score null and Alcoholic hepatitis/NASH in differentials
    let criticalUnknowns = [];
    let confidenceCapped = false;
    const alcoholRelevantConditions = ['Alcoholic hepatitis', 'alcoholic hepatitis', 'NASH', 'nash', 'nonalcoholic steatohepatitis'];
    const hasAlcoholRelevantDx = differentials.some(d =>
      alcoholRelevantConditions.some(c => (d.condition || '').includes(c))
    );
    if (hasAlcoholRelevantDx && (richIntake.alcohol_cage_score == null || richIntake.alcohol_cage_score === '')) {
      criticalUnknowns.push('alcohol history');
      confidenceCapped = true;
    }

    const recommendedLane = this._recommendLane(safetyLevel, urgency, opqrst);

    const patientFriendlySummary = this._buildSummary(specialty, safetyLevel, urgency, secondarySpecialties);

    const specialistContext = this._buildSpecialistContext(specialty, icdCodes, opqrst);

    // gap13: rag_confidence — low when PrimaryCare fallback, weak signals, or M-S3.B cap
    let ragConfidence = this._computeRagConfidence(
      combinedText, icdCodes, specialty
    );
    if (confidenceCapped) ragConfidence = Math.min(ragConfidence, 0.65);

    // gap14: Auto-generate SOAP note after triage (M-S6.B: includes rich intake)
    const soapNote = this._buildSoapNote(symptomText, opqrst, richIntake, specialty, urgency);

    // M-S2.D: Two-pass RAG — second call (after specialty deep-dive) upserts in place, no new row
    // Bug 3: Include patient_id to avoid overwriting when two patients share session_id (race)
    const existingRow = patientId
      ? db.db.prepare(
          `SELECT id FROM triage_rag_results WHERE session_id = ? AND (patient_id = ? OR patient_id IS NULL) ORDER BY created_at DESC LIMIT 1`
        ).get(sessionId, patientId)
      : db.db.prepare(
          `SELECT id FROM triage_rag_results WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`
        ).get(sessionId);
    const isSecondPass = !!existingRow;
    const resultId = existingRow?.id || uuidv4();

    try {
      if (isSecondPass) {
        db.db.prepare(`
          UPDATE triage_rag_results SET
            symptom_text = ?, opqrst_json = ?, icd_codes = ?, cpt_codes = ?,
            target_specialty = ?, secondary_specialties = ?, urgency = ?, safety_level = ?,
            red_flags = ?, recommended_lane = ?, patient_friendly_summary = ?, specialist_context = ?,
            soap_note = ?, rag_confidence = ?, differentials = ?
          WHERE id = ?
        `).run(
          symptomText, JSON.stringify(opqrst), JSON.stringify(icdCodes), JSON.stringify(cptCodes),
          specialty, JSON.stringify(secondarySpecialties), urgency, safetyLevel,
          JSON.stringify(redFlags), recommendedLane, patientFriendlySummary, specialistContext,
          soapNote, ragConfidence, JSON.stringify(differentials || []), resultId
        );
      } else {
      db.db.prepare(`
        INSERT INTO triage_rag_results (
          id, session_id, patient_id, symptom_text, opqrst_json,
          icd_codes, cpt_codes, target_specialty, secondary_specialties,
          urgency, safety_level, red_flags, recommended_lane,
          patient_friendly_summary, specialist_context, differentials, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        resultId, sessionId, patientId, symptomText,
        JSON.stringify(opqrst),
        JSON.stringify(icdCodes), JSON.stringify(cptCodes),
        specialty, JSON.stringify(secondarySpecialties),
        urgency, safetyLevel, JSON.stringify(redFlags), recommendedLane,
        patientFriendlySummary, specialistContext, JSON.stringify(differentials || [])
      );
      try {
        db.db.prepare(`UPDATE triage_rag_results SET soap_note = ?, rag_confidence = ? WHERE id = ?`).run(soapNote, ragConfidence, resultId);
      } catch (_) {}
      }
    } catch (e) {
      console.warn('[TriageRAG] Failed to persist result:', e.message);
    }

    // W3-S4.1: primary_icd10 for billing (differential #1 or first RAG hit)
    const primaryIcd10 = (differentials?.[0]?.icd10 || icdCodes?.[0]?.code || '').trim() || null;

    return {
      id: resultId,
      icd_codes: icdCodes,
      cpt_codes: cptCodes,
      primary_icd10: primaryIcd10,
      target_specialty: specialty,
      secondary_specialties: secondarySpecialties,
      differentials: differentials || [],
      critical_unknowns: criticalUnknowns,
      urgency,
      safety_level: safetyLevel,
      red_flags: redFlags,
      recommended_lane: recommendedLane,
      patient_friendly_summary: patientFriendlySummary,
      specialist_context: specialistContext,
      rag_confidence: ragConfidence,
      soap_note: soapNote
    };
  }

  static _assessSafety(text, opqrst) {
    const combined = text + ' ' + (opqrst.associated_sx || '') + ' ' + (opqrst.quality || '');
    const redFlags = [];

    for (const pattern of RED_FLAG_PATTERNS) {
      if (pattern.test(combined)) {
        redFlags.push(pattern.toString());
      }
    }

    const severity = parseInt(opqrst.severity, 10) || 0;

    if (redFlags.length > 0) {
      return { safetyLevel: 'red', urgency: 'emergent', redFlags };
    }

    let urgency = 'routine';
    for (const pattern of YELLOW_FLAG_PATTERNS) {
      if (pattern.test(combined)) {
        urgency = 'urgent';
        break;
      }
    }

    // gap7: severity ≥8 as routing gate — force urgency, restrict async
    if (severity >= 8) urgency = 'urgent';
    if (severity >= 10) return { safetyLevel: 'red', urgency: 'emergent', redFlags: ['Severity 10/10'] };

    return {
      safetyLevel: urgency === 'urgent' ? 'yellow' : 'green',
      urgency,
      redFlags
    };
  }

  /**
   * W2-S2.4: Interim logic. Stage 3 will drive specialty from differential generation,
   * not keyword/ICD prefix. RAG chunks will provide context; ICD hits alone must not
   * override differential-based specialty.
   */
  static _resolveSpecialty(text, icdCodes) {
    const lower = text.toLowerCase();
    const secondary = [];

    for (const entry of SYMPTOM_SPECIALTY_KEYWORDS) {
      if (entry.keywords.some(kw => lower.includes(kw))) {
        for (const other of SYMPTOM_SPECIALTY_KEYWORDS) {
          if (other.specialty !== entry.specialty && other.keywords.some(kw => lower.includes(kw))) {
            if (!secondary.includes(other.specialty)) secondary.push(other.specialty);
          }
        }
        return { specialty: entry.specialty, secondarySpecialties: secondary.slice(0, 2) };
      }
    }

    for (const icd of icdCodes) {
      const code = (icd.code || '').toUpperCase();
      for (const entry of ICD_SPECIALTY_MAP) {
        if (code.startsWith(entry.prefix)) {
          return { specialty: entry.specialty, secondarySpecialties: secondary };
        }
      }
    }

    return { specialty: 'PrimaryCare', secondarySpecialties: [] };
  }

  static _recommendLane(safetyLevel, urgency, opqrst) {
    if (safetyLevel === 'red') return 'sync';
    if (urgency === 'urgent') return 'sync';
    const severity = parseInt(opqrst.severity, 10) || 0;
    // gap7: severity ≥8 restricts async — route to live sync only
    if (severity >= 7) return 'sync';
    return 'async';
  }

  /** W2-S3.3: When 2+ differentials point to different specialties, summary surfaces both for Kelly to narrate */
  static _buildSummary(specialty, safetyLevel, urgency, secondarySpecialties = []) {
    if (safetyLevel === 'red') {
      return 'Your symptoms may require immediate emergency care. Please call 911 or go to the nearest emergency room.';
    }
    const specialtyLabels = {
      Cardiology: 'a heart and cardiovascular specialist',
      Psychiatry: 'a mental health specialist',
      Dermatology: 'a skin specialist',
      Orthopedics: 'a bone and joint specialist',
      Neurology: 'a neurologist',
      PrimaryCare: 'a primary care physician',
      Pulmonology: 'a lung and breathing specialist',
      Gastroenterology: 'a digestive health specialist',
      Endocrinology: 'a hormone specialist',
      InfectiousDisease: 'an infectious disease specialist'
    };
    const label = specialtyLabels[specialty] || `a ${specialty} specialist`;
    if (secondarySpecialties && secondarySpecialties.length > 0) {
      const otherLabels = secondarySpecialties.map(s => specialtyLabels[s] || `${s} specialist`);
      const combined = [label, ...otherLabels].join(' and ');
      if (urgency === 'urgent') return `Based on your symptoms, you may need both ${combined}. I'm connecting you as soon as possible.`;
      return `Based on what you've described, you may benefit from seeing both ${combined}. Would you like me to find available slots for ${specialty} first, or for another specialty?`;
    }
    if (urgency === 'urgent') return `Based on your symptoms, I'm connecting you with ${label} as soon as possible.`;
    return `Based on what you've described, it looks like you'd benefit from seeing ${label}.`;
  }

  static _buildSpecialistContext(specialty, icdCodes, opqrst) {
    const codes = icdCodes.slice(0, 3).map(c => c.code).join(', ');
    return JSON.stringify({
      specialty,
      primary_codes: codes,
      severity: opqrst.severity || null,
      onset: opqrst.onset || null
    });
  }

  /**
   * W2-S3.1: Generate top-3 differentials via GPT-4o from RAG context.
   * @param {Array} ragChunks - ICD/CPT codes with descriptions (from getCodeCandidates)
   * @param {string} fullClinicalHistory - Combined symptom + OPQRST + PMH
   * @param {Object} richIntake - For M-S3.B confidence cap (alcohol_cage_score)
   * @returns {Promise<Array>} Top 3 differentials
   */
  static async _generateDifferentials(ragChunks, fullClinicalHistory, richIntake = {}) {
    const key = process.env.OPENAI_API_KEY;
    if (!key || !fullClinicalHistory) return [];

    const chunksSummary = (ragChunks || [])
      .slice(0, 10)
      .map(c => `${c.code || ''}: ${(c.description || '').slice(0, 80)}`)
      .filter(Boolean)
      .join('\n');

    const userContent = `RAG codes/candidates:\n${chunksSummary || 'None'}\n\nClinical history:\n${(fullClinicalHistory || '').slice(0, 3000)}`;

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: process.env.TRIAGE_DIFFERENTIAL_MODEL || 'gpt-4o',
          messages: [
            { role: 'system', content: DIFFERENTIAL_SYSTEM_PROMPT },
            { role: 'user', content: userContent }
          ],
          max_tokens: 800,
          temperature: 0.2
        })
      });
      if (!res.ok) return [];
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content?.trim() || '';
      const cleaned = text.replace(/^```\w*\n?|\n?```$/g, '').trim();
      const arr = JSON.parse(cleaned);
      if (!Array.isArray(arr)) return [];
      return arr.slice(0, 3).map(d => ({
        condition: d.condition || '',
        icd10: d.icd10 || '',
        coverage_pct: typeof d.coverage_pct === 'number' ? d.coverage_pct : null,
        mechanism: d.mechanism || '',
        supporting_evidence: d.supporting_evidence || '',
        evidence_against: d.evidence_against || '',
        discriminating_test: d.discriminating_test || '',
        confidence_cap_reason: d.confidence_cap_reason || null
      }));
    } catch (e) {
      console.warn('[TriageRAG] _generateDifferentials failed:', e.message);
      return [];
    }
  }

  static _specialtyFromDifferential(condition) {
    if (!condition || typeof condition !== 'string') return null;
    const c = condition.trim();
    if (DIFFERENTIAL_SPECIALTY_MAP[c]) return DIFFERENTIAL_SPECIALTY_MAP[c];
    const lower = c.toLowerCase();
    for (const [key, specialty] of Object.entries(DIFFERENTIAL_SPECIALTY_MAP)) {
      if (lower.includes(key.toLowerCase())) return specialty;
    }
    return null;
  }

  /** W2-S2.3: combinedText = symptom + full history (OPQRST + PMH + FHx + meds) — not just symptom string */
  static _buildCombinedText(symptomText, opqrst, richIntake = {}) {
    const parts = [symptomText];
    if (opqrst.onset) parts.push(`Started: ${opqrst.onset}`);
    if (opqrst.provocation) parts.push(`Provocation: ${opqrst.provocation}`);
    if (opqrst.quality) parts.push(`Feels like: ${opqrst.quality}`);
    if (opqrst.severity) parts.push(`Severity: ${opqrst.severity}/10`);
    if (opqrst.radiation) parts.push(`Spreads to: ${opqrst.radiation}`);
    if (opqrst.timing) parts.push(`Duration: ${opqrst.timing}`);
    if (opqrst.associated_sx) parts.push(`Also experiencing: ${opqrst.associated_sx}`);
    if (richIntake.family_history) parts.push(`Family history: ${richIntake.family_history}`);
    if (richIntake.medications) parts.push(`Medications: ${richIntake.medications}`);
    if (richIntake.prior_diagnoses) parts.push(`Prior diagnoses: ${richIntake.prior_diagnoses}`);
    if (richIntake.prior_workups) parts.push(`Prior workups: ${richIntake.prior_workups}`);
    if (richIntake.allergies) parts.push(`Allergies: ${richIntake.allergies}`);
    if (richIntake.alcohol_use) parts.push(`Alcohol use: ${richIntake.alcohol_use}`);
    if (richIntake.alcohol_cage_score != null) parts.push(`CAGE score: ${richIntake.alcohol_cage_score}`);
    if (richIntake.smoking_status) parts.push(`Smoking: ${richIntake.smoking_status}`);
    return parts.join('. ');
  }

  /** gap13: Compute confidence 0–1. Low when PrimaryCare fallback or weak signals. */
  static _computeRagConfidence(combinedText, icdCodes, specialty) {
    const lower = (combinedText || '').toLowerCase();
    const keywordMatch = SYMPTOM_SPECIALTY_KEYWORDS.some(entry =>
      entry.keywords.some(kw => lower.includes(kw))
    );
    const hasIcd = icdCodes && icdCodes.length > 0;
    if (specialty === 'PrimaryCare' && !keywordMatch && !hasIcd) return 0.5;
    if (keywordMatch && specialty !== 'PrimaryCare') return 0.9;
    if (hasIcd && specialty !== 'PrimaryCare') return 0.8;
    if (keywordMatch || hasIcd) return 0.75;
    return 0.6;
  }

  /** gap14 + M-S6.B: Build SOAP note from triage data, including rich intake in Subjective */
  static _buildSoapNote(symptomText, opqrst, richIntake = {}, specialty, urgency) {
    const s = [];
    s.push('**Subjective:**');
    s.push(`CC: ${(symptomText || 'Patient-reported symptoms').slice(0, 200)}`);
    const parts = [];
    if (opqrst?.onset) parts.push(`Onset: ${opqrst.onset}`);
    if (opqrst?.quality) parts.push(`Quality: ${opqrst.quality}`);
    if (opqrst?.severity) parts.push(`Severity: ${opqrst.severity}/10`);
    if (opqrst?.radiation) parts.push(`Radiation: ${opqrst.radiation}`);
    if (opqrst?.timing) parts.push(`Timing: ${opqrst.timing}`);
    if (richIntake?.medications) parts.push(`Meds: ${String(richIntake.medications).slice(0, 100)}`);
    if (richIntake?.allergies) parts.push(`Allergies: ${String(richIntake.allergies).slice(0, 80)}`);
    if (richIntake?.family_history) parts.push(`FHx: ${String(richIntake.family_history).slice(0, 80)}`);
    if (richIntake?.prior_diagnoses) parts.push(`PMH: ${String(richIntake.prior_diagnoses).slice(0, 80)}`);
    if (richIntake?.alcohol_cage_score != null) parts.push(`CAGE: ${richIntake.alcohol_cage_score}`);
    if (parts.length) s.push(parts.join('. '));
    s.push('');
    s.push('**Objective:** Triage intake (no physical exam).');
    s.push('');
    s.push(`**Assessment:** ${specialty || 'PrimaryCare'} referral, ${urgency || 'routine'} urgency.`);
    s.push('');
    s.push('**Plan:** Route to specialist, await appointment confirmation.');
    return s.join('\n');
  }

  static getLatestForSession(sessionId) {
    try {
      const row = db.db.prepare(`
        SELECT * FROM triage_rag_results
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(sessionId);
      if (!row) return null;
      const diffs = _safeParseDifferentials(row.differentials);
      const icds = JSON.parse(row.icd_codes || '[]');
      const primaryIcd10 = (diffs?.[0]?.icd10 || icds?.[0]?.code || '').trim() || null;
      return {
        ...row,
        icd_codes: icds,
        cpt_codes: JSON.parse(row.cpt_codes || '[]'),
        secondary_specialties: JSON.parse(row.secondary_specialties || '[]'),
        red_flags: JSON.parse(row.red_flags || '[]'),
        differentials: diffs,
        primary_icd10: primaryIcd10,
        rag_confidence: row.rag_confidence != null ? parseFloat(row.rag_confidence) : 0.7
      };
    } catch (_) { return null; }
  }
}

function _safeParseDifferentials(val) {
  if (val == null || val === '') return [];
  try {
    const arr = JSON.parse(val);
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

module.exports = TriageRAGService;
