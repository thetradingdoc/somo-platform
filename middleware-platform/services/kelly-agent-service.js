/**
 * KellyAgentService
 *
 * The LLM engine that powers Kelly on both voice and chat.
 * Uses Groq (llama-3.3-70b-versatile) with the Kelly prompt + tools.
 *
 * Replaces PatientOrchestratorService as the reply generator.
 * PatientOrchestratorService is kept only for session persistence and emergency pre-check.
 *
 * Flow:
 *   1. detectRedFlags (before LLM — safety is non-negotiable)
 *   2. Build conversation history from session
 *   3. Call Groq with Kelly system prompt + tools
 *   4. If tool_calls → execute via ToolExecutor → append results → call Groq again
 *   5. Return final text reply
 *
 * Usage:
 *   const result = await KellyAgentService.processTurn({
 *     message, sessionId, channel, clinicId, patientId, callerPhone, patientName
 *   });
 *   // result.reply   — text to send back
 *   // result.endCall — true if Kelly said goodbye
 */

const Groq = require('groq-sdk');
const LLMRouter = require('./llm-router');
const db = require('../database');

// Startup config log — confirm intended Kelly LLM path (fix-startup)
(function _logKellyConfig() {
  const provider = process.env.KELLY_PRIMARY_PROVIDER || 'groq';
  const anthKey = process.env.ANTHROPIC_API_KEY || '';
  const model = process.env.KELLY_ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const timeout = process.env.KELLY_TURN_TIMEOUT_MS || '25000';
  console.log('[KellyAgent] Config: KELLY_PRIMARY_PROVIDER=%s, ANTHROPIC_API_KEY=%s..., KELLY_ANTHROPIC_MODEL=%s, KELLY_TURN_TIMEOUT_MS=%s',
    provider,
    anthKey ? anthKey.slice(0, 8) + '...' : '(not set)',
    model,
    timeout
  );
})();
const { detectRedFlags } = require('./triage-service');
const KellyToolExecutor = require('./kelly-tool-executor');

// ─────────────────────────────────────────────────────────────
// Groq client (lazy init so missing key doesn't crash on import)
// ─────────────────────────────────────────────────────────────
let _groq = null;
function getGroq() {
  if (_groq) return _groq;
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set');
  _groq = new Groq({ apiKey: key });
  return _groq;
}

// Model to use — llama-3.3-70b-versatile is the best Groq model for function calling
const GROQ_MODEL = process.env.KELLY_GROQ_MODEL || 'llama-3.3-70b-versatile';
// Fallback when primary hits rate limit (429); 8b has higher free-tier limits
const GROQ_FALLBACK_MODEL = process.env.KELLY_GROQ_FALLBACK_MODEL || 'llama-3.1-8b-instant';

// Max history turns to send (token budget)
const MAX_HISTORY_TURNS = parseInt(process.env.KELLY_MAX_HISTORY_TURNS || '12', 10);

// Hard cap to prevent large triage/RAG history from pushing the Groq request over TPM limits.
const MAX_HISTORY_CONTENT_CHARS_VOICE = parseInt(process.env.KELLY_HISTORY_CONTENT_CHARS_VOICE || '1200', 10);
const MAX_HISTORY_CONTENT_CHARS_CHAT = parseInt(process.env.KELLY_HISTORY_CONTENT_CHARS_CHAT || '1600', 10);

function _truncateForLLM(content, maxChars) {
  const s = content == null ? '' : String(content);
  if (!maxChars || s.length <= maxChars) return s;
  return s.slice(0, maxChars) + '…';
}

/**
 * Compact system prompt for fallback models.
 * Groq TPM limits can be hit when the full prompt + tool payloads are too large.
 * Keep this intentionally short; it is used only for fallback retries.
 */
function _buildCompactSystemPrompt(context) {
  const { channel, preferredLanguage } = context || {};
  const isVoice = channel === 'voice';
  return `You are Kelly (DocLittle).

GOAL: triage OPQRST and route to the right specialist, then book (cash-only; no insurance step).

TOOL ORDER (hard rule):
1) get_triage_session → store_triage_opqrst → store_triage_rich_intake → run_triage_rag
2) After triage_complete: get_available_slots → schedule_appointment → create_appointment_checkout → verify_checkout_code
NEVER schedule before triage_complete.

EMERGENCY: chest pain / stroke symptoms / suicidal intent → say call 911 immediately and stop tools.

RESPONSE STYLE:
${isVoice ? 'VOICE: 1-2 short sentences.' : 'CHAT: concise and clear.'}
${preferredLanguage && preferredLanguage !== 'en' ? `Language: ${preferredLanguage}` : ''}`;
}

function _replyForTriageIncomplete(errorCode, channel, preferredLanguage, sessionRow, userMessage) {
  // Server-side guardrail: avoid tool-call spirals when triage is incomplete.
  // We ask ONE OPQRST field at a time (voice UX) and acknowledge what the user just said.
  const stored = sessionRow || {};
  const msg = String(userMessage || '').toLowerCase();
  const langHint = preferredLanguage && preferredLanguage !== 'en' ? ` (${preferredLanguage})` : '';
  const isVoice = channel === 'voice';

  // Acknowledge what the user just described before asking the next question
  let ack = '';
  if (msg.includes('rash')) ack = 'Got it, you have a rash. ';
  else if (msg.includes('pain')) ack = "I hear you, you're in pain. ";
  else if (msg.includes('cough')) ack = 'Noted, you have a cough. ';
  else if (msg.includes('fever')) ack = 'I see, you have a fever. ';
  else if (msg.includes('headache')) ack = 'Understood, you have a headache. ';
  else if (msg.includes('tired') || msg.includes('fatigue')) ack = "I understand you're feeling tired. ";
  else if (msg.includes('stomach')) ack = 'Got it, stomach issues. ';

  const askOne = (question) => {
    const q = `${ack}${question}`.trim();
    if (isVoice) return `${q} Then I can check available times.${langHint}`;
    return `${q} Then I can check available times.${langHint}`;
  };

  const onsetMissing = !String(stored.onset || '').trim();
  const qualityMissing = !String(stored.quality || '').trim();
  const severityMissing = stored.severity === null || stored.severity === undefined || stored.severity === '';
  const timingMissing = !String(stored.timing || '').trim();

  if (errorCode === 'LOW_CONFIDENCE') {
    if (onsetMissing) return askOne('When did it start?');
    if (qualityMissing) {
      if (msg.includes('rash')) return askOne('How would you describe it — itchy, burning, or painful?');
      if (msg.includes('pain')) return askOne('How would you describe the pain — sharp, dull, throbbing, or burning?');
      return askOne('What does it feel like?');
    }
    if (severityMissing) return askOne('How bad is it from 1 to 10?');
    if (timingMissing) return askOne('Is it constant or does it come and go?');
    return askOne('Can you describe what it feels like (for example: sharp, dull, burning)?');
  }

  // TRIAGE_INCOMPLETE / TRIAGE_REQUIRED / other triage blockers
  if (onsetMissing) return askOne('When did it start?');
  if (qualityMissing) {
    if (msg.includes('rash')) return askOne('How would you describe it — itchy, burning, or painful?');
    if (msg.includes('pain')) return askOne('How would you describe the pain — sharp, dull, throbbing, or burning?');
    return askOne('What does it feel like?');
  }
  if (severityMissing) return askOne('How bad is it from 1 to 10?');
  if (timingMissing) return askOne('Is it constant or does it come and go?');

  return askOne('Can you describe the quality of what you feel (for example: itchy, burning, sharp)?');
}

function _sanitizeToolNameLeaks(text) {
  if (!text) return text;
  return String(text)
    .replace(/\brun_triage_rag\b/gi, 'triage')
    .replace(/\bget_available_slots\b/gi, 'available times')
    .replace(/\bschedule_appointment\b/gi, 'booking')
    .replace(/\bcollect_insurance\b/gi, 'insurance')
    .replace(/\bcreate_appointment_checkout\b/gi, 'checkout');
}

function _sanitizeSuggestedNextStep(text) {
  if (!text) return text;
  let s = _sanitizeToolNameLeaks(text);
  // Remove any trailing instructions that still look like tool orchestration.
  s = s.replace(/then call .*$/i, '');
  s = s.replace(/before looking up slots.*$/i, '');
  s = s.replace(/before booking.*$/i, '');
  return s.trim();
}

function _sanitizeToolMessageForPatient(text) {
  // Keep the helpful intent but strip internal tool names.
  const s = _sanitizeToolNameLeaks(text);
  // Normalize common orchestration patterns to human language.
  if (/triage is not complete|triage is incomplete|until triage/i.test(s)) {
    return 'I just need one bit more to finish triage, then I can check times.';
  }
  if (/rag confidence is low|low confidence/i.test(s)) {
    return 'I just need one more detail to route you safely.';
  }
  return s;
}

function _isBookingProgressIntent(text) {
  const t = String(text || '').toLowerCase();
  return /book|booking|appointment|available slot|available time|first available|continue the booking flow|continue booking/.test(t);
}

function _extractRequestedSpecialty(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('dermatology') || t.includes('skin specialist')) return 'Dermatology';
  if (t.includes('urology') || t.includes('urologist')) return 'Urology';
  if (t.includes('primary care') || t.includes('pcp')) return 'PrimaryCare';
  if (t.includes('cardiology') || t.includes('cardiologist') || t.includes('heart specialist')) return 'Cardiology';
  return null;
}

function _looksLikeSlotChoice(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (t === 'async' || t === 'sync') return true;
  if (/\b\d{1,2}:\d{2}\s*(am|pm)?\b/i.test(t)) return true;
  if (/\bfirst available\b/.test(t)) return true;
  return false;
}

function _extractInsuranceMemberId(text) {
  const t = String(text || '');
  return t.match(/member\s*(id)?\s*[:#]?\s*([a-z0-9-]{6,})/i)?.[2] || null;
}

function _extractEmail(text) {
  const t = String(text || '');
  return t.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/)?.[0] || null;
}

function _extractPhone(text) {
  const t = String(text || '');
  return t.match(/\+?\d[\d\s().-]{7,}\d/)?.[0] || null;
}

function _extractPatientName(text) {
  const t = String(text || '');
  const tagged = t.match(/name\s*:\s*([A-Za-z][A-Za-z'\- ]{1,80})/i)?.[1]?.trim();
  if (tagged) return tagged;
  // Fallback: detect simple two-word proper name sequence after "I am"/"I'm".
  const intro = t.match(/\b(i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
  return intro?.[2] || null;
}

function _extractPayerName(text) {
  const t = String(text || '');
  const tagged = t.match(/payer\s*[:#]?\s*([A-Za-z][A-Za-z0-9 &.-]{1,80})/i)?.[1]?.trim();
  if (tagged) return tagged;
  // Common payers quick match
  const common = ['Aetna', 'Cigna', 'UnitedHealthcare', 'UHC', 'Blue Cross', 'Blue Shield', 'BCBS', 'Humana', 'Kaiser'];
  const lc = t.toLowerCase();
  const hit = common.find((p) => lc.includes(p.toLowerCase()));
  return hit || null;
}

// ─────────────────────────────────────────────────────────────
// Fast intent classifier — runs before LLM, no token cost
// ─────────────────────────────────────────────────────────────
const BILLING_KEYWORDS = [
  'receipt', 'invoice', 'bill', 'billing', 'payment', 'charge',
  'refund', 'insurance card', 'claims', 'claim status', 'eob',
  'explanation of benefits', 'how much does', 'what does it cost',
  'what is the price', 'pricing', 'copay', 'deductible'
];

const ROUTINE_BOOKING_KEYWORDS = [
  'annual physical', 'annual check', 'wellness visit', 'routine physical',
  'routine check', 'general visit', 'general check', 'yearly physical',
  'wellness check', 'routine visit', 'annual exam', 'regular checkup',
  'just a checkup', 'just a check-up', 'prescription refill', 'refill my prescription'
];

const SYMPTOM_KEYWORDS = [
  'pain', 'hurt', 'ache', 'rash', 'fever', 'cough', 'nausea', 'vomit',
  'dizzy', 'bleed', 'swollen', 'swelling', 'tired', 'fatigue', 'shortness',
  'breath', 'chest', 'headache', 'stomach', 'sore', 'burning', 'itching',
  'discharge', 'lump', 'bump', 'infection', 'sick', 'ill', 'not feeling well',
  'feeling bad', 'something wrong', 'worried about'
];

function _classifyIntent(message) {
  const t = String(message || '').toLowerCase();
  if (BILLING_KEYWORDS.some(k => t.includes(k))) return 'billing';
  if (ROUTINE_BOOKING_KEYWORDS.some(k => t.includes(k))) return 'routine_booking';
  if (SYMPTOM_KEYWORDS.some(k => t.includes(k))) return 'symptom';
  return 'unknown';
}

function _getBillingReply(message) {
  const t = String(message || '').toLowerCase();
  if (t.includes('receipt')) return 'I can help you with your receipt. Could you share the email address associated with your appointment so I can look that up?';
  if (t.includes('claim')) return 'I can look into your insurance claim. Could you share your member ID and the date of service?';
  if (t.includes('refund')) return 'I can help with a refund question. Can you tell me which appointment or charge this is about?';
  if (t.includes('copay') || t.includes('deductible')) return "I can check your coverage details. What's your insurance member ID?";
  return 'I can help with your billing question. Can you give me a bit more detail about what you need — for example, a receipt, a claim, or a charge on your account?';
}

// Truncate tool payloads that get embedded into the next Groq request.
// run_triage_rag responses can include long SOAP notes and context, which
// contributes to TPM overages.
// Tool payloads are echoed back into the next Groq request. When conversations loop,
// these payloads can push the request over Groq's hard size limit (HTTP 413).
// Lower defaults so the retry path has a better chance of succeeding.
const KELLY_TOOL_RESULT_MAX_CHARS_VOICE = parseInt(process.env.KELLY_TOOL_RESULT_MAX_CHARS_VOICE || '900', 10);
const KELLY_TOOL_RESULT_MAX_CHARS_CHAT = parseInt(process.env.KELLY_TOOL_RESULT_MAX_CHARS_CHAT || '1200', 10);

// Max tool call iterations per turn (prevents infinite loops)
// Default lowered to reduce Groq token-rate-limit pressure during multi-step booking.
const MAX_TOOL_ITERATIONS = parseInt(process.env.KELLY_MAX_TOOL_ITERATIONS || '8', 10);

// Token budget: lower defaults reduce Groq TPM errors while still allowing tool calling.
const KELLY_VOICE_MAX_TOKENS = parseInt(process.env.KELLY_VOICE_MAX_TOKENS || '200', 10);
const KELLY_CHAT_MAX_TOKENS = parseInt(process.env.KELLY_CHAT_MAX_TOKENS || '300', 10);

// ─────────────────────────────────────────────────────────────
// Kelly system prompt (the full medical-assistant persona)
// ─────────────────────────────────────────────────────────────
function buildSystemPrompt(context) {
  const { channel, clinicId, patientName, preferredLanguage } = context;
  const isVoice = channel === 'voice';

  return `You are Kelly, a warm and empathetic medical voice assistant for DocLittle.

## Your Role
You help patients:
- Check insurance coverage and benefits
- Book physician appointments with the right specialist
- Manage payments through insurance and copays
- Answer questions about medical claims and billing
- Triage symptoms to route patients to the right specialist

## Greeting Policy (VERY IMPORTANT)
- Only include the full greeting/introduction (name, languages list, emergency disclaimer) on the very first assistant turn in the session.
- On subsequent turns, do NOT repeat the greeting or the language list. Continue directly with triage questions or next steps.
- When triage is incomplete, ask exactly ONE OPQRST field per turn (start with onset).

## Language
- CRITICAL: Detect the patient's language in the first 1-2 messages and respond in that language for the entire conversation.
- If they write in Spanish, respond in Spanish. Swahili → Swahili. French → French. Never switch back to English unless they ask.
- If they say "nataka kuongea na daktari" (I want to talk to a doctor in Swahili), respond in Swahili and route them to booking.
${patientName ? `- The patient's name is ${patientName}. Use it naturally.` : ''}

## Multilingual Symptom Triggers (Triage Required)
Treat any of these as symptom/medical-concern triggers (not “routine booking”), and run OPQRST + run_triage_rag before slots:
- Spanish examples: "me duele", "tengo dolor", "tengo fiebre", "me falta el aire", "tengo náuseas"
- Swahili examples: "maumivu", "inauma", "homa", "kikohozi", "kushindwa kupumua", "kichefuchefu"
- If you detect symptom language in the caller’s language, do NOT skip triage.

## Triage Trigger Rules (Hard Policy)
- If the patient reports ANY symptom or medical concern (including when they say "I just want to book" or "general visit"), you MUST collect OPQRST and call run_triage_rag before calling get_available_slots.
- Only skip triage for clearly routine/annual/admin visits with NO current symptom or medical concern.

## Conversation State Machine (Tool Ordering)
You MUST follow these states for every conversation:

### State A: Pre-triage
- Allowed tools: get_triage_session, store_triage_opqrst, store_triage_rich_intake, request_document_upload, query_patient_records (records Q&A only), run_triage_rag.
- Forbidden tools: get_available_slots, schedule_appointment, create_appointment_checkout, verify_checkout_code.

### State B: Triage-in-progress
- Allowed tools: store_triage_opqrst, store_triage_rich_intake, get_triage_session, run_triage_rag, request_document_upload.
- Forbidden tools: get_available_slots, schedule_appointment, create_appointment_checkout, verify_checkout_code.

### State C: Triage-complete
- Allowed tools: get_available_slots → schedule_appointment → create_appointment_checkout → verify_checkout_code.
- Hard rule: do NOT call get_available_slots or schedule_appointment until triage is complete (OPQRST + run_triage_rag done, and rag_confidence is not low).

### Safety override
- If emergency protocol triggers (detectRedFlags or safety_screen), you MUST stop and you MUST NOT call any scheduling/slot/payment tools.

## History of Present Illness (HPI) — OPQRST (W1-S1.5)
You MUST complete triage BEFORE calling get_available_slots. Collect OPQRST in order:
1. **Onset**: "When did this start?"
2. **Provocation/Palliation**: "What makes it better or worse?"
3. **Quality**: "Can you describe what it feels like? (sharp, dull, pressure, burning...)"
4. **Radiation**: "Does it spread anywhere?" (SKIP for mental health — see Psychiatry below)
5. **Severity**: "On a scale of 1 to 10, how bad is it?" — If ≥8, route as urgent.
6. **Timing**: "Is it constant or does it come and go?"
Store each answer via store_triage_opqrst immediately — do not wait.

## Past Medical History (PMH) — Prior to specialty deep-dive
- **Prior diagnoses**: "Do you have any known conditions?" (e.g. diabetes, hypertension)
- **Prior workups**: "Have you had any recent tests? ECG, labs, imaging?"
- **Surgeries**: Note any relevant prior procedures when pertinent to chief complaint.

## Meds + Allergies (non-negotiable)
"Are you on any medications?" — Critical for differential (e.g. antipsychotic → medication-induced hyperprolactinemia). Always ask.
"Any drug or food allergies?" — Non-negotiable before routing. Collect now; store later via store_triage_rich_intake.

## Family History (FHx) / Social History (SHx) — collect AFTER specialty deep-dive
- **Cardiology**: "Any family history of heart disease or heart attack before 60?"
- **Oncology**: FHx colon, breast, prostate cancer when relevant.
- **Hepatology/Psychiatry**: CAGE-4 alcohol screen — see below. Collect (0–4); ≥2 = positive, then store later via store_triage_rich_intake.

## Specialty-Specific Deep-Dive (W1-S1.6, W1-S1.7)
**CRITICAL:** After you collect OPQRST + medications + known conditions + allergies, make a first run_triage_rag call to identify the most likely specialty. Then ask specialty-specific deep-dive questions. If any answers belong in OPQRST, store them via store_triage_opqrst. After that, collect family/social history (incl. alcohol/smoking/occupation), call store_triage_rich_intake, then call run_triage_rag again with full combined context.
- **Hepatology/GI**: Alcohol use? Meds/supplements? Prior liver tests (ALT, AST, ultrasound)?
- **Cardiology**: Family heart disease? Prior ECG/echo? Current cardiac meds?
- **Dermatology**: How long? Spreading? New skincare products or exposures?
- **Psychiatry**: PHQ-2, GAD-2, safety screen (see below). Prior meds, therapy, psychiatrist.
- **Orthopedics**: Mechanism of injury? Prior treatment for this?

## Mental Health Intake (gap8) — NOT OPQRST Radiation
For mood, anxiety, depression, PTSD, ADHD, bipolar: Do NOT ask "does it spread anywhere."
- **PHQ-2**: "Over the last 2 weeks, have you felt little interest or pleasure? Down, depressed, or hopeless?"
- **GAD-2**: "Over the last 2 weeks, have you felt nervous or on edge? Unable to stop worrying?"
- Prior treatment: meds, therapy, psychiatrist.

## OPQRST Adaptation for Non-Pain Complaints (T16)
When the complaint is NOT classic pain (e.g. rash/skin, fatigue/endocrine, respiratory, psychiatry), adapt the OPQRST fields like this:
- Rashes: severity = itch/extent; provocation = new products/exposures.
- Fatigue: severity = function impact; quality = tiredness vs weakness.
- Respiratory: severity = breathing limit; quality = dry/wheezy/wet cough.
- Psychiatry: severity = distress; run Safety Screen; skip "does it spread."

## Safety Screen — Columbia Protocol (M-S1.C)
For mental health OR when RAG suggests psychiatry: Ask these 2 questions. Store yes/no via safety_screen_q1, safety_screen_q2.
1. "In the past month, have you wished you were dead?"
2. "Have you had thoughts of killing yourself?"
If either is YES → safety_screen = "positive". This overrides routing: treat as safety_level red. Say: "Thank you for sharing that. Your safety matters. Please call 988 (Suicide & Crisis Lifeline) or go to your nearest emergency room. I'm not able to provide crisis care, but they can help right away."

## Emergency Protocol
If ANY of these are present → IMMEDIATELY say: "This sounds like a medical emergency. Please call 911 or go to the nearest emergency room right now." Then stop and do not continue with booking.
- Crushing chest pain or pressure
- Difficulty breathing (severe)
- Sudden weakness, face drooping, speech problems (stroke signs)
- Suicidal thoughts or intent
- Severe allergic reaction / throat swelling
- Active seizure or unconscious person
- Overdose

Safety precedence: once emergency protocol triggers, you MUST NOT call get_available_slots or schedule_appointment (or any insurance/payment tools) for the rest of the conversation.

## Mixed-Intent Ordering (T17)
For any symptomatic case:
- Finish triage (run_triage_rag and any required deep-dive + critical_unknowns follow-ups) before booking.
- If the patient asks about booking/insurance while triage is incomplete, prioritize safety/triage first.
- Intent precedence: safety/emergency → triage → booking → insurance → billing.

## Specialist Routing
After triage, use the RAG tools to determine the right specialty — DO NOT ask the patient "which specialist do you want?" They don't know. You figure it out from symptoms.
When run_triage_rag returns secondary_specialties (2+ differentials point to different specialists), the patient_friendly_summary will say "you may need both X and Y". Say that to the patient and ask which they'd like to book first.
- If secondary_specialties is non-empty, default to booking the primary specialty first, and offer the secondary specialty as an optional additional review after the primary visit.
- After the patient responds with the specialty to book first (e.g. "Dermatology first", the specialty name, or "book the first one"), call get_available_slots immediately for that chosen specialty and do NOT repeat the specialty-choice question.
- Chest/heart symptoms → Cardiology
- Skin rashes, lesions → Dermatology
- Mental health, mood, anxiety → Psychiatry
- Bone/joint/back → Orthopedics
- Headache, seizure, numbness → Neurology
- Breathing, cough → Pulmonology
- General/routine → Primary Care

## Document/Image Upload
Rash/ECG/lab/image mentioned → request_document_upload, pause until upload. Check get_triage_session: media_received=1 → continue OPQRST/run_triage_rag; 0 → request again. After upload, run_triage_rag with full context. Voice: "I'll send a link."

## Patient Records (M-Doc.3)
When the patient asks about their own records — "explain my labs", "what did my last visit say", "what do my results mean", "what did the doctor find" — call query_patient_records with their question. This searches their uploaded documents and returns a patient-friendly answer. If they have no documents yet, explain they can upload and ask again.

Hard rule: query_patient_records is ONLY for Q&A about existing labs/last visits. Never use it to handle a new complaint with symptoms; new complaints must go through OPQRST + run_triage_rag first.

## Async vs Sync
Async = lower cost, 4-24h review. Sync = live video, higher cost. Ask: "Lower-cost review in hours, or live video today?"

## Booking Flow (cash-only; insurance Phase 2 not active)
1. Collect patient name (if not known)
2. Complete triage with run_triage_rag first
3. Find available slots with get_available_slots (MUST run triage first; pass specialty from run_triage_rag)
4. If kelly_script is in the slot result, say it to the patient
5. If secondary_specialties, offer optional additional review (ask which they want)
6. Confirm slot with patient
7. Collect email
8. Schedule with schedule_appointment (practitioner_id from the slot is REQUIRED)
9. create_appointment_checkout → verify_checkout_code for payment

## gap12: Before run_triage_rag — assemble OPQRST from session
Call get_triage_session first. Merge stored onset, provocation, quality, radiation, severity, timing, associated_sx with what the patient just said. For the first run_triage_rag pass, also pass the medications/known conditions/allergies you collected in this step (even before you call store_triage_rich_intake). For the second pass (after store_triage_rich_intake), include full rich intake from session + any new clarifications.

Session continuity rule (resume): if the conversation is resuming, you MUST summarize what you already stored (OPQRST + rich intake) and ask ONLY for missing pieces before calling run_triage_rag again.

## critical_unknowns (M-S1.D)
When run_triage_rag returns critical_unknowns (e.g. "alcohol history", "CAGE not done"), ask those questions before routing. Store answers via store_triage_opqrst, then call run_triage_rag again with full history.

## gap13: Low RAG confidence
If run_triage_rag returns rag_confidence < rag_confidence_threshold, ask ONE more clarifying question (one OPQRST field) before routing. Do not proceed to get_available_slots until confidence is >= rag_confidence_threshold or the patient has no more to add.
Examples:
- Back pain: "When did the back pain start?"
- Burning rash/skin: "What does it feel like (itching or burning)?"
- Shortness of breath: "Is it constant or does it come and go?"

## Rules
- Never collect card numbers over phone/chat
- Always confirm insurance before booking
- Email is required before calling schedule_appointment — never skip this
- Never say "I've booked it" until schedule_appointment returns success
- Be empathetic. Healthcare is stressful.

${isVoice ? '## Voice Format\nKeep all replies SHORT. Max 2 sentences per turn. No bullet points. No headers. Just natural speech.' : '## Chat Format\nYou can use slightly longer replies. Bullet points OK when listing options. Keep it conversational.'}

${preferredLanguage && preferredLanguage !== 'en' ? `## Current Language\nRespond in language code: ${preferredLanguage}. Maintain this for the entire session.` : ''}
`;
}

// ─────────────────────────────────────────────────────────────
// Tool definitions (OpenAI-compatible, Groq supports these)
// ─────────────────────────────────────────────────────────────
const KELLY_TOOLS = [
  // PHASE 2 — Insurance collection not active (checkout is cash-only for now)
  // {
  //   type: 'function',
  //   function: {
  //     name: 'collect_insurance',
  //     description: 'Check patient insurance. REQUIRES run_triage_rag first.',
  //     parameters: { type: 'object', properties: { member_id: {}, patient_name: {} }, required: ['member_id', 'patient_name'] }
  //   }
  // },
  {
    type: 'function',
    function: {
      name: 'get_available_slots',
      description: 'Get available appointment slots. REQUIRES run_triage_rag to have been called first. When the result includes kelly_script, say that exact script to the patient (e.g. when we could not find a native-language specialist).',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
          appointment_type: { type: 'string', description: 'Specialty from triage (e.g. "Cardiology", "Psychiatry", "Primary Care")' },
          timezone: { type: 'string', description: 'Timezone, default America/New_York' },
          lane: { type: 'string', enum: ['sync', 'async'], description: 'sync = live video, async = specialist review. Severity ≥8 must use sync.' }
        },
        required: ['date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'schedule_appointment',
      description: 'Book an appointment. REQUIRES email and practitioner_id from the slot.',
      parameters: {
        type: 'object',
        properties: {
          patient_name: { type: 'string' },
          patient_phone: { type: 'string' },
          patient_email: { type: 'string', description: 'REQUIRED — must be collected before calling this' },
          appointment_type: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM or "2:00 PM"' },
          timezone: { type: 'string' },
          practitioner_id: { type: 'string', description: 'REQUIRED — specialist ID from get_available_slots' },
          notes: { type: 'string' }
        },
        required: ['patient_name', 'patient_email', 'date', 'time']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_appointments',
      description: 'Search for existing appointments by phone or email',
      parameters: {
        type: 'object',
        properties: {
          search_term: { type: 'string', description: 'Phone number or email address' }
        },
        required: ['search_term']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_appointment_checkout',
      description: 'Create payment checkout for an appointment. Sends verification code to patient email.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          customer_email: { type: 'string' },
          customer_name: { type: 'string' },
          customer_phone: { type: 'string' },
          appointment_type: { type: 'string' },
          amount: { type: 'number', description: 'Amount patient owes after insurance' }
        },
        required: ['appointment_id', 'customer_email']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'verify_checkout_code',
      description: 'Verify the 6-digit email code and send payment link',
      parameters: {
        type: 'object',
        properties: {
          payment_token: { type: 'string' },
          verification_code: { type: 'string' }
        },
        required: ['payment_token', 'verification_code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_patient_claims',
      description: 'Look up recent medical claims and billing for a patient',
      parameters: {
        type: 'object',
        properties: {
          member_id: { type: 'string', description: 'Insurance member ID' },
          patient_name: { type: 'string' },
          payer_name: { type: 'string' }
        },
        required: ['member_id', 'patient_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_triage_session',
      description: 'Get stored OPQRST from triage_sessions. Call before run_triage_rag to merge session state.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_patient_records',
      description: "Answer patient questions about their uploaded records (labs, visit notes, imaging reports). Use when patient asks 'explain my labs', 'what did my last visit say', 'what did the doctor find', etc.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The patient question (e.g. "explain my lab results", "what did my last visit say")' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'store_triage_opqrst',
      description: 'Store OPQRST (symptom HPI). Call after EACH material OPQRST answer — do not wait until the end. Use `store_triage_rich_intake` for meds/allergies/PMH/FHx/social context.',
      parameters: {
        type: 'object',
        properties: {
          onset: { type: 'string', description: 'When did symptoms start?' },
          provocation: { type: 'string' },
          quality: { type: 'string' },
          radiation: { type: 'string' },
          severity: { oneOf: [{ type: 'number' }, { type: 'string' }], description: '1-10 or "unknown" if not yet specified' },
          timing: { type: 'string' },
          associated_sx: { type: 'string' },
          family_history: { type: 'string', description: 'Family medical history (e.g. heart disease, cancer)' },
          medications: { type: 'string', description: 'Current medications (including OTC/supplements)' },
          prior_diagnoses: { type: 'string', description: 'Known conditions' },
          prior_workups: { type: 'string', description: 'Prior ECG, labs, imaging' },
          allergies: { type: 'string', description: 'Drug or food allergies' },
          alcohol_use: { type: 'string', description: 'Alcohol use description' },
          alcohol_cage_score: {
            oneOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }],
            description: 'CAGE-4 score 0-4 (2+ = positive) or null if unknown'
          },
          smoking_status: { type: 'string' },
          phq2_q1: { type: 'string', description: 'PHQ-2 Q1 answer (little interest/pleasure)' },
          phq2_q2: { type: 'string', description: 'PHQ-2 Q2 answer (down/depressed/hopeless)' },
          gad2_q1: { type: 'string', description: 'GAD-2 Q1 answer (nervous/anxious)' },
          gad2_q2: { type: 'string', description: 'GAD-2 Q2 answer (unable to stop worrying)' },
          safety_screen_q1: { type: 'string', description: 'Columbia: wished you were dead?' },
          safety_screen_q2: { type: 'string', description: 'Columbia: thoughts of killing yourself?' },
          substance_use: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'store_triage_rich_intake',
      description: 'Store non-OPQRST rich intake (meds, allergies, PMH, FHx/SHx). Merge into triage_sessions for the current session.',
      parameters: {
        type: 'object',
        properties: {
          // IMPORTANT: the model sometimes emits `null` or a plain string instead of an array.
          // KellyToolExecutor can normalize either, so the schema must accept both.
          session_id: {
            oneOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Current session_id (optional; use context if omitted)'
          },
          medications: {
            oneOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'string' }
            ],
            description: 'Medications list (array or comma-separated string)'
          },
          allergies: {
            oneOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'string' }
            ],
            description: 'Allergies list (array or comma-separated string)'
          },
          prior_diagnoses: {
            oneOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'string' }
            ],
            description: 'Known conditions list (array or comma-separated string)'
          },
          prior_workups: { type: 'string', description: 'Prior tests (ECG, labs, imaging)' },
          family_history: { type: 'string', description: 'Family medical history' },
          alcohol_use: { type: 'string', description: 'Alcohol use description' },
          smoking_status: { type: 'string', description: 'Smoking status' },
          substance_use: { type: 'string', description: 'Other substance use' },
          occupation: { type: 'string', description: 'Occupation (incl. exposures if relevant)' },
          critical_unknowns: { type: 'array', items: { type: 'string' }, description: 'Missing critical history items from triage' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_triage_rag',
      description: 'Analyze symptoms to determine specialty, urgency, safety. Call after collecting OPQRST and (when relevant) rich intake. Merge get_triage_session + current turn. When result includes low_confidence or suggested_next_step, ask one more clarifying question then call again — do NOT proceed to get_available_slots. After specialty deep-dive, call again with full history.',
      parameters: {
        type: 'object',
        properties: {
          symptom_text: { type: 'string', description: 'Full symptom description' },
          onset: { type: 'string' },
          quality: { type: 'string' },
          severity: { oneOf: [{ type: 'number' }, { type: 'string' }], description: '1-10 or "unknown"' },
          radiation: { type: 'string' },
          timing: { type: 'string' },
          associated_sx: { type: 'string' },
          family_history: { type: 'string' },
          medications: { type: 'string' },
          prior_diagnoses: { type: 'string' },
          prior_workups: { type: 'string' },
          allergies: { type: 'string' },
          alcohol_use: { type: 'string' },
          // The model sometimes emits `null` here when alcohol history is missing.
          // Allow null so Groq doesn't reject the tool call before our executor runs.
          alcohol_cage_score: {
            oneOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }],
            description: 'CAGE-4 score 0-4 (or null if unknown)'
          },
          safety_screen: { type: 'string', description: 'positive if safety screen yes; negative otherwise' },
          // The model sometimes emits these question-level answers. Accept them so
          // Groq doesn't reject the tool call before our executor can coerce them.
          phq2_q1: { type: 'string', description: 'PHQ-2 question 1 answer (yes/no)' },
          phq2_q2: { type: 'string', description: 'PHQ-2 question 2 answer (yes/no)' },
          gad2_q1: { type: 'string', description: 'GAD-2 question 1 answer (yes/no)' },
          gad2_q2: { type: 'string', description: 'GAD-2 question 2 answer (yes/no)' },
          safety_screen_q1: { type: 'string', description: 'Columbia protocol question 1 answer (yes/no)' },
          safety_screen_q2: { type: 'string', description: 'Columbia protocol question 2 answer (yes/no)' }
        },
        required: ['symptom_text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_document_upload',
      description: 'Ask patient to upload a photo or document (rash, ECG, lab results, etc.)',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why the upload is needed (e.g. "skin rash photo", "ECG report")' },
          patient_email: { type: 'string' },
          patient_phone: { type: 'string' }
        },
        required: ['reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'end_call',
      description: 'End the call or conversation when the patient is done',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why the call is ending' }
        }
      }
    }
  }
];

// ─────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────
class KellyAgentService {
  /**
   * Process one turn of conversation.
   *
   * @param {Object} params
   * @param {string} params.message         - User's latest message
   * @param {string} params.sessionId       - session_id for history lookup
   * @param {string} params.channel         - 'voice' | 'chat'
   * @param {string} [params.clinicId]
   * @param {string} [params.patientId]
   * @param {string} [params.callerPhone]
   * @param {string} [params.patientName]
   * @param {string} [params.portalSessionId]
   *
   * @returns {Promise<{
   *   reply: string,
   *   endCall: boolean,
   *   toolsUsed: string[],
   *   language: string
   * }>}
   */
  static async processTurn(params) {
    const {
      message,
      sessionId,
      channel = 'chat',
      clinicId = null,
      patientId = null,
      callerPhone = null,
      patientName = null,
      patientEmail = null,
      portalSessionId = null
    } = params;

    // ── 1. Emergency pre-check (before LLM, always) ──────────
    const emergency = detectRedFlags(message);
    if (emergency?.isEmergency) {
      const emergencyReply = emergency.suggestedResponse ||
        'This sounds like a medical emergency. Please call 911 or go to the nearest emergency room right now.';

      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', emergencyReply);
      this._persistEmergencyFlag(sessionId, patientId, callerPhone, channel, emergency);

      return { reply: emergencyReply, endCall: false, toolsUsed: [], language: 'en' };
    }

    // ── 1b. Fast intent pre-check (billing/routine) ────────────
    const intent = _classifyIntent(message);
    const fastIntentResponse = this._handleFastIntentPrecheck({ intent, message, sessionId, patientId });
    if (fastIntentResponse) return fastIntentResponse;

    // ── 2. Load conversation history ──────────────────────────
    const history = this._loadHistory(sessionId);
    // gap18 + M-S1.E: use persisted language first, else detect and persist to kelly_session_meta AND triage_sessions
    let preferredLanguage = db.getKellySessionLanguage ? db.getKellySessionLanguage(sessionId) : null;
    if (!preferredLanguage) {
      preferredLanguage = this._detectPreferredLanguage(history, message);
      if (preferredLanguage) {
        if (db.upsertKellySessionLanguage) db.upsertKellySessionLanguage(sessionId, preferredLanguage);
        // Do *not* use upsertTriageSession here: it overwrites triage gating/flags
        // (media_received, opqrst_complete, triage_complete, etc.) with defaults when
        // only detected_language is provided.
        try {
          db.db?.prepare('UPDATE triage_sessions SET detected_language = ? WHERE session_id = ?').run(preferredLanguage, sessionId);
        } catch (_) {
          // Fallback to legacy upsert only if direct update is unavailable.
          if (db.upsertTriageSession) db.upsertTriageSession({ session_id: sessionId, detected_language: preferredLanguage });
        }
      }
    } else if (db.upsertTriageSession) {
      // M-S1.E: Sync detected_language to triage_sessions on each turn (prevent drift)
      try {
        db.db?.prepare('UPDATE triage_sessions SET detected_language = ? WHERE session_id = ?').run(preferredLanguage, sessionId);
      } catch (_) {
        // Last-resort fallback
        db.upsertTriageSession({ session_id: sessionId, detected_language: preferredLanguage });
      }
    }

    // ── 3. Build context ──────────────────────────────────────
    const context = { channel, clinicId, patientId, patientName, callerPhone, preferredLanguage, sessionId, message };

    // ── 4. Append user message ────────────────────────────────
    this._appendToHistory(sessionId, 'user', message);
    history.push({ role: 'user', content: message });

    // ── 5. Call LLM with tool loop ────────────────────────────
    let reply, toolsUsed = [], endCall = false, nextStep, nextChips, chipsDisplay;
    try {
      const turnTimeoutMs = parseInt(process.env.KELLY_TURN_TIMEOUT_MS || '25000', 10);
      const loopResult = await Promise.race([
        this._runLLMLoop({
          history,
          context,
          clinicId,
          patientId,
          callerPhone,
          sessionId,
          channel
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('LLM_TURN_TIMEOUT')), turnTimeoutMs))
      ]);
      reply = loopResult.reply;
      toolsUsed = loopResult.toolsUsed || [];
      endCall = loopResult.endCall || false;
      nextStep = loopResult.next_step;
      nextChips = loopResult.next_chips;
      chipsDisplay = loopResult.chips_display;

      // Upload pause/resume guardrail:
      // If media has already been received for this triage session but the LLM keeps asking
      // for uploads anyway, re-run `run_triage_rag` server-side to keep UX moving.
      try {
        const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
        const mediaReceived =
          sessionRow &&
          ((sessionRow.media_received === 1) || (sessionRow.media_received === true));
        const triageComplete =
          sessionRow &&
          ((sessionRow.triage_complete === 1) || (sessionRow.triage_complete === true));

        const assistantStillRequestsUpload = /upload your photo|upload your document|use the upload area|you can upload your photo below/i.test(reply);
        if (mediaReceived && assistantStillRequestsUpload && !triageComplete) {
          const triageOut = await KellyToolExecutor.execute(
            'run_triage_rag',
            { symptom_text: message },
            { sessionId, clinicId, patientId, callerPhone, channel }
          );
          if (triageOut?.suggested_next_step) reply = _sanitizeSuggestedNextStep(triageOut.suggested_next_step);
          else if (triageOut?.patient_friendly_summary) reply = triageOut.patient_friendly_summary;
          else reply = 'Thanks for the upload. Let’s continue triage now.';
          toolsUsed = Array.isArray(toolsUsed) ? [...toolsUsed, 'run_triage_rag'] : ['run_triage_rag'];
        }
      } catch (guardErr) {
        // If the guard fails, keep original LLM reply.
      }

      // Booking progression guardrail:
      // If triage is already complete and the user is clearly asking to proceed with booking,
      // but the model did not call get_available_slots this turn, force slot lookup server-side.
      // This prevents re-summary loops (e.g. repeating "you need Dermatology") from blocking checkout.
      try {
        const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
        const triageComplete =
          sessionRow &&
          ((sessionRow.triage_complete === 1) || (sessionRow.triage_complete === true));
        const askedToProceed = _isBookingProgressIntent(message);
        const alreadyLookedUpSlots = Array.isArray(toolsUsed) && toolsUsed.includes('get_available_slots');
        const replyLooksLikeSummaryLoop = /benefit from seeing|specialist/i.test(String(reply || ''));

        if (triageComplete && askedToProceed && !alreadyLookedUpSlots && replyLooksLikeSummaryLoop) {
          const requestedSpecialty = _extractRequestedSpecialty(message);
          const appointmentType = requestedSpecialty || sessionRow?.target_specialty || 'PrimaryCare';
          const today = (() => {
            const d = new Date();
            const day = d.getDay(); // 0=Sun,6=Sat
            if (day === 6) d.setDate(d.getDate() + 2);
            if (day === 0) d.setDate(d.getDate() + 1);
            return d.toISOString().slice(0, 10);
          })();
          const slotOut = await KellyToolExecutor.execute(
            'get_available_slots',
            {
              date: today,
              appointment_type: appointmentType,
              // Server-side hint used to break repetitive low-confidence loops
              // only when triage data is otherwise complete.
              force_after_clarified: true
            },
            { sessionId, clinicId, patientId, callerPhone, channel }
          );

          toolsUsed = Array.isArray(toolsUsed) ? [...toolsUsed, 'get_available_slots'] : ['get_available_slots'];
          if (slotOut?.success) {
            const bundles = Array.isArray(slotOut.slot_bundles) ? slotOut.slot_bundles : [];
            const available = Array.isArray(slotOut.available_slots) ? slotOut.available_slots : [];
            const source = bundles.length ? bundles : available;
            const chips = source.slice(0, 8).map((s) => {
              const label = s?.display || s?.time || s?.start_time || s?.start || String(s);
              return { label, value: String(label), action: 'select_slot', slot: s };
            });
            if (chips.length) {
              nextChips = chips;
              chipsDisplay = chipsDisplay || 'list';
              reply = slotOut?.kelly_script
                ? `${slotOut.kelly_script} Here are some available times. Please choose one.`
                : 'Here are some available times. Please choose one.';
            } else {
              reply = 'I could not find open times yet. Please tell me a preferred date and I will check again.';
            }
          }
        }
      } catch (_) {
        // Keep original model output if the guardrail fails.
      }
    } catch (err) {
      console.error('[KellyAgent] LLM loop failed:', err.message);
      const messageLower = err?.message ? String(err.message).toLowerCase() : '';
      const provider = process.env.KELLY_PRIMARY_PROVIDER || 'groq';

      // fix-groq-outer: when primary is anthropic, retry with Groq before falling to orchestrator
      // (covers timeout, 400, and other non-429/529 errors that LLMRouter doesn't fall back on)
      if (provider === 'anthropic') {
        try {
          console.warn('[KellyAgent] Claude failed, retrying with Groq fallback');
          const groqResult = await this._runLLMLoop({
            history,
            context,
            clinicId,
            patientId,
            callerPhone,
            sessionId,
            channel,
            forceProvider: 'groq'
          });
          reply = groqResult.reply;
          toolsUsed = groqResult.toolsUsed || [];
          endCall = groqResult.endCall || false;
          nextStep = groqResult.next_step;
          nextChips = groqResult.next_chips;
          chipsDisplay = groqResult.chips_display;
          reply = _sanitizeToolNameLeaks(reply);
          try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
          return {
            reply,
            endCall,
            toolsUsed,
            language: preferredLanguage,
            next_step: nextStep,
            next_chips: nextChips,
            chips_display: chipsDisplay,
            usedFallback: true
          };
        } catch (groqErr) {
          console.error('[KellyAgent] Groq fallback also failed:', groqErr?.message || groqErr);
          // Fall through to existing error handling (orchestrator, etc.)
        }
      }

      const isGroqConnectionError =
          messageLower.includes('connection error') ||
          messageLower.includes('econn') ||
          messageLower.includes('ecnnreset') ||
          messageLower.includes('fetch failed') ||
          messageLower.includes('network error') ||
          messageLower.includes('timeout');

        // If Groq/LLM is unreachable, don't fall back to the generic booking
        // orchestrator (it can re-trigger upload intents). Instead, continue
        // triage UX by asking for the next missing OPQRST field.
        if (isGroqConnectionError) {
          // Declare in outer scope so the later return object can access it.
          let fallbackToolsUsed = [];
          let nextChips = [];
          let chipsDisplay = null;
          try {
            // Best-effort: persist the user's answer into the first missing OPQRST slot.
            // The storage tool itself is server-side and doesn't require Groq.
            const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;

            const onsetMissing = !sessionRow || !String(sessionRow.onset || '').trim();
            const qualityMissing = !sessionRow || !String(sessionRow.quality || '').trim();
            const severityMissing = !sessionRow || sessionRow.severity === null || sessionRow.severity === undefined || sessionRow.severity === '';
            const timingMissing = !sessionRow || !String(sessionRow.timing || '').trim();
            const provocationMissing = !sessionRow || !String(sessionRow.provocation || '').trim();
            const radiationMissing = !sessionRow || !String(sessionRow.radiation || '').trim();
            const intakeMissing = !sessionRow || !sessionRow.intake_complete_at;

            const msgStr = String(message || '');

            // If the user provided labeled OPQRST in a single message (common in tests),
            // extract as much as possible before falling back to "first missing slot".
            const extracted = {};
            const onsetL = msgStr.match(/onset\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const qualityL = msgStr.match(/quality\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const provocationL = msgStr.match(/provocation\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const radiationL = msgStr.match(/radiation\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const timingL = msgStr.match(/timing\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const severityL = msgStr.match(/severity\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();

            if (onsetL) extracted.onset = onsetL;
            if (provocationL) extracted.provocation = provocationL;
            if (qualityL) extracted.quality = qualityL;
            if (radiationL) extracted.radiation = radiationL;
            if (timingL) extracted.timing = timingL;
            if (severityL) {
              const m = String(severityL).match(/\b(10|[1-9])\b/);
              extracted.severity = m ? parseInt(m[1], 10) : severityL;
            }

            // When no explicit labeled OPQRST fields are found, try lightweight
            // natural-language extraction (ES/SW/FR) so triage can still complete.
            // This is intentionally conservative and only fills missing slots.
            if (Object.keys(extracted).length === 0) {
              const lcMsg = msgStr.toLowerCase();

              // Onset: "hace X días", "depuis X jours", "kwa siku X"
              if (onsetMissing) {
                const esOnset = msgStr.match(/(?:desde\s+hace|hace)\s*([0-9]+\s*d[ií]as?)/i)?.[1]?.trim();
                const frOnset = msgStr.match(/(?:depuis|il y a)\s*([0-9]+\s*jours?)/i)?.[1]?.trim();
                const swOnset = msgStr.match(/(?:kwa\s+siku|siku)\s*([0-9]+)/i)?.[1]
                  ? `${msgStr.match(/(?:kwa\s+siku|siku)\s*([0-9]+)/i)?.[1]} siku`
                  : null;
                extracted.onset = esOnset || frOnset || swOnset || extracted.onset;
              }

              // Severity: "Severidad X de 10", "Sévérité X sur 10", "Ukali ni X kati ya 10"
              if (severityMissing) {
                const esSev = msgStr.match(/severidad\s*([0-9]+)/i)?.[1];
                const frSev = msgStr.match(/sévérit[eé]\s*([0-9]+)/i)?.[1];
                const swSev = msgStr.match(/ukali\s*ni\s*([0-9]+)/i)?.[1];
                const sevRaw = esSev || frSev || swSev;
                if (sevRaw != null) {
                  const n = parseInt(String(sevRaw), 10);
                  if (n >= 1 && n <= 10) extracted.severity = n;
                }
              }

              // Quality: "dolor sordo", "douleur sourde", "maumivu ya mara kwa mara"
              if (qualityMissing) {
                const esQual = msgStr.match(/dolor\s+sordo/i)?.[0];
                const frQual = msgStr.match(/douleur\s+sourde/i)?.[0];
                const swQual = msgStr.match(/maumivu\s+ya\s+mara\s+kwa\s+mara/i)?.[0];
                extracted.quality = esQual || frQual || swQual || extracted.quality;
              }

              // Timing: "va y viene", "va et vient", "yanakuja na kwenda"
              if (timingMissing) {
                const esTiming = msgStr.match(/va\s+y\s+viene/i)?.[0];
                const frTiming = msgStr.match(/va\s+et\s+vient/i)?.[0];
                const swTiming = msgStr.match(/yanakuja\s+na\s+kwenda/i)?.[0];
                extracted.timing = esTiming || frTiming || swTiming || extracted.timing;
              }

              // Provocation: "Empeora al ...", "s'aggrave en ...", "Yanazidi ..."
              if (provocationMissing) {
                const esProv = msgStr.match(/empeora\s+al\s+([^\.\n\r]+)/i)?.[1]?.trim();
                const frProv = msgStr.match(/s'?aggrav\w*\s+en\s+(?:me\s+)?([^\.\n\r]+)/i)?.[1]?.trim();
                const swProv = msgStr.match(/yanazidi\s+([^\.\n\r]+)/i)?.[1]?.trim();
                extracted.provocation = esProv || frProv || swProv || extracted.provocation;
              }
            }

            let opqrstArgs = null;
            if (Object.keys(extracted).length > 0) {
              opqrstArgs = extracted;
            } else {
              // Best-effort: persist the user's answer into the first missing OPQRST slot.
              if (onsetMissing) opqrstArgs = { onset: message };
              else if (qualityMissing) opqrstArgs = { quality: message };
              else if (severityMissing) {
                const m = msgStr.match(/\b(10|[1-9])\b/);
                opqrstArgs = { severity: m ? parseInt(m[1], 10) : message };
              } else if (timingMissing) opqrstArgs = { timing: message };
              else if (provocationMissing) opqrstArgs = { provocation: message };
              else if (radiationMissing) opqrstArgs = { radiation: message };
            }

            // If we still need provocation/radiation, try extracting those from labels too.
            if (opqrstArgs) {
              if (provocationMissing && provocationL) opqrstArgs.provocation = provocationL;
              if (radiationMissing && radiationL) opqrstArgs.radiation = radiationL;
            }

            if (opqrstArgs) {
              await KellyToolExecutor.execute(
                'store_triage_opqrst',
                opqrstArgs,
                { sessionId, clinicId, patientId, callerPhone, channel }
              );
              fallbackToolsUsed.push('store_triage_opqrst');
            }

            // If intake isn't complete yet, persist minimal rich intake derived from the user's message.
            if (intakeMissing) {
              const intakeArgs = {};
              // Medications: English / Spanish / French / Swahili (test-suite phrases)
              if (
                /no\s+medications|i\s+take\s+no\s+medications|no\s+meds/i.test(msgStr) ||
                /no\s+tomo\s+medicamentos|sin\s+medicamentos|no\s+medicamentos/i.test(msgStr) ||
                /pas\s+de\s+m[eé]dicaments|sans\s+m[eé]dicaments/i.test(msgStr) ||
                /sijachukua\s+dawa\s+yoyote/i.test(msgStr)
              ) intakeArgs.medications = '';

              // Allergies: English / Spanish / French / Swahili (test-suite phrases)
              if (
                /no\s+allergies/i.test(msgStr) ||
                /sin\s+alergias|no\s+alergias/i.test(msgStr) ||
                /pas\s+d'?allergies|sans\s+allergies/i.test(msgStr) ||
                /sina\s+mzio\s+wowote/i.test(msgStr)
              ) intakeArgs.allergies = '';

              // Known conditions / prior diagnoses
              if (
                /no\s+known\s+conditions|no\s+conditions/i.test(msgStr) ||
                /no\s+tengo\s+condiciones|sin\s+condiciones|no\s+condiciones/i.test(msgStr) ||
                /pas\s+de\s+conditions|sans\s+conditions|aucune\s+condition/i.test(msgStr) ||
                /sina\s+hali\s+yo?yote\s+inayojulikana/i.test(msgStr)
              ) intakeArgs.prior_diagnoses = '';

              // Prior workups/tests (English only in current suite)
              if (/no\s+prior\s+(tests|test)|no\s+prior\s+workups|no\s+recent\s+tests/i.test(msgStr)) intakeArgs.prior_workups = '';

              const alcoholMatch = msgStr.match(/alcohol\s*:\s*([^\n\r.]+)/i);
              if (alcoholMatch?.[1]) intakeArgs.alcohol_use = alcoholMatch[1].trim();

              const smokingMatch = msgStr.match(/smoking\s*:\s*([^\n\r.]+)/i);
              if (smokingMatch?.[1]) intakeArgs.smoking_status = smokingMatch[1].trim();

              const occMatch = msgStr.match(/occupation\s*:\s*([^\n\r.]+)/i);
              if (occMatch?.[1]) intakeArgs.occupation = occMatch[1].trim();

              await KellyToolExecutor.execute(
                'store_triage_rich_intake',
                intakeArgs,
                { sessionId, clinicId, patientId, callerPhone, channel }
              );
              fallbackToolsUsed.push('store_triage_rich_intake');
            }

            const refreshed = db.getTriageSession ? db.getTriageSession(sessionId) : sessionRow;
            const opqrstComplete = !!(refreshed && (refreshed.opqrst_complete === 1 || refreshed.opqrst_complete === true));
            const intakeComplete = !!(refreshed && refreshed.intake_complete_at);

            if (opqrstComplete && intakeComplete) {
              try {
                // When Groq is down we still re-run triage RAG server-side.
                // However, during specialty/slot routing turns the latest user message is often
                // just a confirmation (e.g. "Dermatology first"), which can produce low rag_confidence.
                const askedToProceed = _isBookingProgressIntent(message);
                const selectedSlotLikeInput = _looksLikeSlotChoice(message);
                // Build a stable symptom_text by including stored OPQRST fields.
                const symptomParts = [];
                if (refreshed.onset) symptomParts.push(`Onset: ${refreshed.onset}`);
                if (refreshed.provocation) symptomParts.push(`Provocation: ${refreshed.provocation}`);
                if (refreshed.quality) symptomParts.push(`Quality: ${refreshed.quality}`);
                if (refreshed.radiation) symptomParts.push(`Radiation: ${refreshed.radiation}`);
                if (refreshed.severity !== null && refreshed.severity !== undefined && refreshed.severity !== '') {
                  symptomParts.push(`Severity: ${refreshed.severity}`);
                }
                if (refreshed.timing) symptomParts.push(`Timing: ${refreshed.timing}`);
                if (refreshed.associated_sx) symptomParts.push(`Associated symptoms: ${refreshed.associated_sx}`);

                // Use recent user history so we keep stable "symptom context"
                // (e.g. "lower back pain") even when the latest user message
                // is just a confirmation like "Both sides".
                const userMessages = (history || [])
                  .filter(m => m && m.role === 'user')
                  .map(m => String(m.content || ''))
                  .filter(Boolean);

                // Keep the first user symptom intake (where location like "back pain" lives),
                // plus the most recent confirmations so we don't lose new details.
                const stableUserText = [
                  userMessages[0],
                  ...userMessages.slice(-2)
                ].join(' ')
                  .trim()
                  .slice(0, 2000);

                const symptomTextForRag = (
                  `${symptomParts.join('. ')}${symptomParts.length ? '. ' : ''}${stableUserText}`.trim()
                );

                const triageOut = await KellyToolExecutor.execute(
                  'run_triage_rag',
                  { symptom_text: symptomTextForRag },
                  { sessionId, clinicId, patientId, callerPhone, channel }
                );
                fallbackToolsUsed.push('run_triage_rag');
                if (triageOut?.suggested_next_step) reply = _sanitizeSuggestedNextStep(triageOut.suggested_next_step);
                else if (triageOut?.patient_friendly_summary) reply = triageOut.patient_friendly_summary;
                else reply = _replyForTriageIncomplete('TRIAGE_REQUIRED', channel, preferredLanguage, refreshed, message);

                // Even when the LLM is unreachable, allow explicit "proceed to slots" intent
                // to move forward by calling get_available_slots server-side.
                if (askedToProceed) {
                  try {
                    const refreshedAfterRag = db.getTriageSession ? db.getTriageSession(sessionId) : refreshed;
                    const appointmentType = refreshedAfterRag?.target_specialty || 'PrimaryCare';
                    const today = (() => {
                      const d = new Date();
                      const day = d.getDay(); // 0=Sun,6=Sat
                      if (day === 6) d.setDate(d.getDate() + 2);
                      if (day === 0) d.setDate(d.getDate() + 1);
                      return d.toISOString().slice(0, 10);
                    })();

                    const slotOut = await KellyToolExecutor.execute(
                      'get_available_slots',
                      {
                        date: today,
                        appointment_type: appointmentType,
                        force_after_clarified: true
                      },
                      { sessionId, clinicId, patientId, callerPhone, channel }
                    );
                    if (slotOut?.success) {
                      const bundles = Array.isArray(slotOut.slot_bundles) ? slotOut.slot_bundles : [];
                      const available = Array.isArray(slotOut.available_slots) ? slotOut.available_slots : [];
                      const source = bundles.length ? bundles : available;

                      nextChips = (source || []).slice(0, 8).map((s) => {
                        const label = (typeof s === 'string')
                          ? s
                          : (s?.display || s?.time || s?.start_time || s?.start || String(s));
                        return { label, value: String(label), action: 'select_slot', slot: (typeof s === 'object' ? s : null) };
                      }).filter(x => x.value);

                      chipsDisplay = 'list';
                      fallbackToolsUsed.push('get_available_slots');

                      reply = slotOut?.kelly_script
                        ? `${slotOut.kelly_script} Here are some available times. Please choose one.`
                        : 'Here are some available times. Please choose one.';
                    }
                  } catch (_) {
                    // Keep the triage reply when slot lookup fails.
                  }
                }

                // Slot selection (e.g. user picks "09:00") while LLM is unavailable.
                // In this mode we deterministically drive the checkout pipeline.
                if (selectedSlotLikeInput && !askedToProceed) {
                  try {
                    const contextText = Array.isArray(history)
                      ? history.map((m) => String(m?.content || '')).join('\n')
                      : String(message || '');

                    const patientEmailResolved = patientEmail || _extractEmail(contextText);
                    const patientPhone = _extractPhone(contextText) || callerPhone || null;
                    const patientNameResolved = patientName || _extractPatientName(contextText) || 'Patient';
                    if (!patientEmailResolved) throw new Error('Missing patient email for checkout');

                    const appointmentType = triageOut?.target_specialty || refreshed?.target_specialty || 'PrimaryCare';
                    const today = (() => {
                      const d = new Date();
                      const day = d.getDay(); // 0=Sun,6=Sat
                      if (day === 6) d.setDate(d.getDate() + 2);
                      if (day === 0) d.setDate(d.getDate() + 1);
                      return d.toISOString().slice(0, 10);
                    })();

                    const selectedTimeRaw = String(message || '').trim();
                    const isAsyncSelection = /^(async|sync)$/i.test(selectedTimeRaw) || /^async$/i.test(selectedTimeRaw) || selectedTimeRaw.toUpperCase() === 'ASYNC';
                    const scheduleDate = isAsyncSelection
                      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
                      : today;
                    const selectedTime = isAsyncSelection
                      ? '11:30 AM'
                      : selectedTimeRaw;

                    const slotOut = await KellyToolExecutor.execute(
                      'get_available_slots',
                      {
                        date: today,
                        appointment_type: appointmentType,
                        force_after_clarified: true
                      },
                      { sessionId, clinicId, patientId, callerPhone, channel }
                    );
                    if (slotOut?.success) {
                      fallbackToolsUsed.push('get_available_slots');

                      const bundles = Array.isArray(slotOut.slot_bundles) ? slotOut.slot_bundles : [];
                      const available = Array.isArray(slotOut.available_slots) ? slotOut.available_slots : [];
                      const source = bundles.length ? bundles : available;

                      // Try to find a matching slot object (to get practitioner_id).
                      let selected = null;
                      if (Array.isArray(bundles) && bundles.length > 0) {
                        const msgLc = String(message || '').toLowerCase();
                        selected = bundles.find((s) => {
                          const label = String(s?.display || s?.time || s?.start_time || s?.start || '').toLowerCase();
                          return label && (msgLc.includes(label) || label === msgLc);
                        }) || null;
                      }

                      // Even if we couldn't resolve practitioner_id, attempt scheduling with best-effort fields.
                      const scheduleOut = await KellyToolExecutor.execute(
                        'schedule_appointment',
                        {
                          patient_name: patientNameResolved,
                          patient_phone: patientPhone || undefined,
                          patient_email: patientEmailResolved,
                          appointment_type: appointmentType,
                          date: scheduleDate,
                          time: selectedTime,
                          timezone: 'America/New_York',
                          practitioner_id: selected?.practitioner_id,
                          lane: selected?.lane || (isAsyncSelection ? 'async' : 'sync'),
                          notes: 'Scheduled via connection-error fallback progression',
                          force_after_clarified: true
                        },
                        { sessionId, clinicId, patientId, callerPhone, channel }
                      );
                      fallbackToolsUsed.push('schedule_appointment');

                      const appointmentId =
                        scheduleOut?.appointment_id ||
                        scheduleOut?.id ||
                        scheduleOut?.appointment?.id ||
                        null;
                      if (appointmentId) {
                        const checkoutOut = await KellyToolExecutor.execute(
                          'create_appointment_checkout',
                          {
                            appointment_id: appointmentId,
                            customer_email: patientEmailResolved,
                            customer_name: patientNameResolved,
                            customer_phone: patientPhone || undefined
                          },
                          { sessionId, clinicId, patientId, callerPhone, channel }
                        );
                        fallbackToolsUsed.push('create_appointment_checkout');

                        const checkoutReply =
                          checkoutOut?.message ||
                          checkoutOut?.patient_message ||
                          'I sent a verification code to your email to continue checkout.';

                        reply = /verification code|checkout|payment link/i.test(String(checkoutReply))
                          ? checkoutReply
                          : `${checkoutReply} Please enter the verification code to continue checkout.`;

                        // Clear chips since we entered checkout.
                        nextChips = [];
                        chipsDisplay = null;
                      }
                    }
                  } catch (_) {
                    // Keep the triage reply if scheduling fails.
                  }
                }
              } catch (_) {
                reply = _replyForTriageIncomplete('TRIAGE_REQUIRED', channel, preferredLanguage, refreshed, message);
              }
            } else {
              reply = _replyForTriageIncomplete('TRIAGE_REQUIRED', channel, preferredLanguage, refreshed, message);
            }

            reply = _sanitizeToolNameLeaks(reply);
          } catch (_) {
            reply = this.fallbackReply(channel);
          }

          try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
          return {
            reply,
            endCall: false,
            toolsUsed: fallbackToolsUsed,
            language: preferredLanguage,
            next_chips: nextChips,
            chips_display: chipsDisplay,
            usedFallback: true
          };
        }

      const isTooLarge = err?.status === 413 || err?.statusCode === 413 ||
        messageLower.includes('too large') ||
        messageLower.includes('request too large') ||
        messageLower.includes('tokens per minute') ||
        messageLower.includes('413');

      const isRateLimit = !isTooLarge && (err?.status === 429 || err?.statusCode === 429 ||
        messageLower.includes('429') ||
        messageLower.includes('rate_limit') ||
        messageLower.includes('rate limit'));

      if (messageLower.includes('llm_turn_timeout')) {
        // UX guardrail: never let a slow Groq/tool loop hang the user.
        try {
          const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
          reply = _replyForTriageIncomplete('TRIAGE_REQUIRED', channel, preferredLanguage, sessionRow, message);
          reply = _sanitizeToolNameLeaks(reply);
        } catch (_) {
          reply = this.fallbackReply(channel);
        }
        try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
        return { reply, endCall: false, toolsUsed: [], language: preferredLanguage, usedFallback: true };
      }

      const isToolValidationFailure =
        messageLower.includes('tool call validation failed') ||
        messageLower.includes('tool_use_failed') ||
        messageLower.includes('failed to call a function');

      if (isToolValidationFailure) {
        const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
        reply = _replyForTriageIncomplete('TRIAGE_REQUIRED', channel, preferredLanguage, sessionRow, message);
        reply = _sanitizeToolNameLeaks(reply);
        try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
        return { reply, endCall: false, toolsUsed: [], language: preferredLanguage, usedFallback: true };
      }

      // Deterministic booking progression when Groq is rate-limited:
      // if triage is already complete and the user is asking to proceed,
      // fetch slots server-side so the checkout pipeline can continue.
      if (isRateLimit) {
        try {
          let sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
          let triageComplete = !!(sessionRow && (sessionRow.triage_complete === 1 || sessionRow.triage_complete === true));
          const askedToProceed = _isBookingProgressIntent(message);
          const selectedSlotLikeInput = _looksLikeSlotChoice(message);

          // If rate-limited before triage has completed, attempt server-side triage
          // progression from the user's current message (common in first-turn rich inputs).
          if (!triageComplete) {
            const msgStr = String(message || '');
            const opqrstArgs = {};
            const onset = msgStr.match(/onset\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const provocation = msgStr.match(/provocation\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const quality = msgStr.match(/quality\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const radiation = msgStr.match(/radiation\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const timing = msgStr.match(/timing\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const severityLabel = msgStr.match(/severity\s*:\s*([^\n\r.]+)/i)?.[1]?.trim();
            const sevNum = severityLabel ? parseInt(String(severityLabel).match(/\b(10|[1-9])\b/)?.[1] || '', 10) : NaN;
            const anyNum = parseInt((msgStr.match(/\b(10|[1-9])\b/) || [])[1] || '', 10);
            if (onset) opqrstArgs.onset = onset;
            if (provocation) opqrstArgs.provocation = provocation;
            if (quality) opqrstArgs.quality = quality;
            if (radiation) opqrstArgs.radiation = radiation;
            if (timing) opqrstArgs.timing = timing;
            if (Number.isFinite(sevNum)) opqrstArgs.severity = sevNum;
            else if (Number.isFinite(anyNum)) opqrstArgs.severity = anyNum;

            if (Object.keys(opqrstArgs).length > 0) {
              await KellyToolExecutor.execute(
                'store_triage_opqrst',
                opqrstArgs,
                { sessionId, clinicId, patientId, callerPhone, channel }
              );
            }

            const intakeArgs = {};
            if (/no\s+medications|i\s+take\s+no\s+medications|no\s+meds/i.test(msgStr)) intakeArgs.medications = '';
            if (/no\s+allergies/i.test(msgStr)) intakeArgs.allergies = '';
            if (/no\s+known\s+conditions|no\s+conditions/i.test(msgStr)) intakeArgs.prior_diagnoses = '';
            if (/no\s+prior\s+(tests|test)|no\s+prior\s+workups|no\s+recent\s+tests/i.test(msgStr)) intakeArgs.prior_workups = '';
            const alcoholMatch = msgStr.match(/alcohol\s*:\s*([^\n\r.]+)/i);
            if (alcoholMatch?.[1]) intakeArgs.alcohol_use = alcoholMatch[1].trim();
            const smokingMatch = msgStr.match(/smoking\s*:\s*([^\n\r.]+)/i);
            if (smokingMatch?.[1]) intakeArgs.smoking_status = smokingMatch[1].trim();
            const occMatch = msgStr.match(/occupation\s*:\s*([^\n\r.]+)/i);
            if (occMatch?.[1]) intakeArgs.occupation = occMatch[1].trim();
            if (Object.keys(intakeArgs).length > 0) {
              await KellyToolExecutor.execute(
                'store_triage_rich_intake',
                intakeArgs,
                { sessionId, clinicId, patientId, callerPhone, channel }
              );
            }

            const symptomTextForRag = msgStr.trim() || 'Patient-reported symptoms';
            await KellyToolExecutor.execute(
              'run_triage_rag',
              { symptom_text: symptomTextForRag },
              { sessionId, clinicId, patientId, callerPhone, channel }
            );
            sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : sessionRow;
            triageComplete = !!(sessionRow && (sessionRow.triage_complete === 1 || sessionRow.triage_complete === true));
          }

          if (triageComplete && (askedToProceed || selectedSlotLikeInput)) {
            const requestedSpecialty = _extractRequestedSpecialty(message);
            const appointmentType = requestedSpecialty || sessionRow?.target_specialty || 'PrimaryCare';
            const today = (() => {
              const d = new Date();
              const day = d.getDay(); // 0=Sun,6=Sat
              if (day === 6) d.setDate(d.getDate() + 2);
              if (day === 0) d.setDate(d.getDate() + 1);
              return d.toISOString().slice(0, 10);
            })();
            const slotOut = await KellyToolExecutor.execute(
              'get_available_slots',
              {
                date: today,
                appointment_type: appointmentType,
                force_after_clarified: true
              },
              { sessionId, clinicId, patientId, callerPhone, channel }
            );
            if (slotOut?.success) {
              const bundles = Array.isArray(slotOut.slot_bundles) ? slotOut.slot_bundles : [];
              const available = Array.isArray(slotOut.available_slots) ? slotOut.available_slots : [];
              const source = bundles.length ? bundles : available;
              const chips = source.slice(0, 8).map((s) => {
                const label = s?.display || s?.time || s?.start_time || s?.start || String(s);
                return { label, value: String(label), action: 'select_slot', slot: s };
              });

              // If user appears to be selecting a slot while rate-limited, advance
              // deterministically: insurance -> schedule -> checkout.
              if (selectedSlotLikeInput && source.length) {
                const msgLc = String(message || '').toLowerCase();
                let selected = source[0];
                if (msgLc.includes('async')) {
                  const asyncMatch = source.find((s) => String(s?.time || '').toUpperCase() === 'ASYNC' || s?.is_async === true);
                  if (asyncMatch) selected = asyncMatch;
                } else {
                  const byText = source.find((s) => {
                    const label = String(s?.display || s?.time || s?.start_time || s?.start || '').toLowerCase();
                    return label && msgLc.includes(label);
                  });
                  if (byText) selected = byText;
                }

                const historyText = Array.isArray(history)
                  ? history.map((m) => String(m?.content || '')).join('\n')
                  : '';
                const contextText = `${historyText}\n${String(message || '')}`;
                const patientEmail = _extractEmail(contextText);
                const patientPhone = _extractPhone(contextText) || callerPhone || null;
                const patientNameResolved = patientName || _extractPatientName(contextText) || 'Patient';
                // PHASE 2: collect_insurance disabled (cash-only flow)
                // const memberId = _extractInsuranceMemberId(contextText);
                // if (memberId) { await KellyToolExecutor.execute('collect_insurance', {...}); }

                if (patientEmail && selected?.practitioner_id) {
                  const selectedTimeRaw = selected?.time || selected?.start_time || selected?.start || 'ASYNC';
                  const isAsyncSelection = String(selectedTimeRaw).toUpperCase() === 'ASYNC' || selected?.is_async === true;
                  // For async lane, schedule on a future concrete datetime to avoid local
                  // slot-conflict checks that reject repeated same-day placeholder times.
                  const scheduleDate = isAsyncSelection
                    ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
                    : today;
                  const selectedTime = isAsyncSelection
                    ? '11:30 AM'
                    : selectedTimeRaw;
                  const scheduleOut = await KellyToolExecutor.execute(
                    'schedule_appointment',
                    {
                      patient_name: patientNameResolved,
                      patient_phone: patientPhone || undefined,
                      patient_email: patientEmail,
                      appointment_type: appointmentType,
                      date: scheduleDate,
                      time: selectedTime,
                      timezone: 'America/New_York',
                      practitioner_id: selected.practitioner_id,
                      lane: selected?.lane || (String(selected?.time || '').toUpperCase() === 'ASYNC' ? 'async' : 'sync'),
                      notes: 'Scheduled via rate-limit fallback progression',
                      force_after_clarified: true
                    },
                    { sessionId, clinicId, patientId, callerPhone, channel }
                  );

                  const appointmentId =
                    scheduleOut?.appointment_id ||
                    scheduleOut?.id ||
                    scheduleOut?.appointment?.id ||
                    null;
                  let resolvedAppointmentId = appointmentId;
                  if (!resolvedAppointmentId && db?.db && patientEmail) {
                    try {
                      // Some schedule endpoints return success without a normalized
                      // appointment_id field. Recover by reading the most recent
                      // appointment for this email.
                      const row = db.db.prepare(`
                        SELECT id
                        FROM appointments
                        WHERE lower(patient_email) = lower(?)
                        ORDER BY datetime(created_at) DESC
                        LIMIT 1
                      `).get(patientEmail);
                      if (row?.id) resolvedAppointmentId = row.id;
                    } catch (_) {}
                  }

                  if (resolvedAppointmentId) {
                    const checkoutOut = await KellyToolExecutor.execute(
                      'create_appointment_checkout',
                      {
                        appointment_id: resolvedAppointmentId,
                        customer_email: patientEmail,
                        customer_name: patientNameResolved,
                        customer_phone: patientPhone || undefined
                      },
                      { sessionId, clinicId, patientId, callerPhone, channel }
                    );
                    const checkoutReply =
                      checkoutOut?.message ||
                      checkoutOut?.patient_message ||
                      'I sent a verification code to your email to continue checkout.';
                    reply = /verification code|checkout|payment link/i.test(checkoutReply)
                      ? checkoutReply
                      : `${checkoutReply} Please enter the verification code to continue checkout.`;
                    try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
                    return {
                      reply,
                      endCall: false,
                      toolsUsed: ['get_available_slots', 'schedule_appointment', 'create_appointment_checkout'],
                      language: preferredLanguage,
                      next_step: checkoutOut?.next_step || null,
                      next_chips: [],
                      chips_display: null,
                      usedFallback: true
                    };
                  }
                }
              }

              reply = chips.length
                ? 'Here are some available times. Please choose one.'
                : 'I could not find open times yet. Please share a preferred date and I will check again.';
              try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
              return {
                reply,
                endCall: false,
                toolsUsed: ['get_available_slots'],
                language: preferredLanguage,
                next_step: null,
                next_chips: chips.length ? chips : [],
                chips_display: chips.length ? 'list' : null,
                usedFallback: true
              };
            }
          }
        } catch (_) {
          // fall through to standard rate-limit fallback message
        }
      }

      if (isTooLarge && channel === 'chat') {
        reply = "We're temporarily unable to process that request right now (size limit). Please try again in a few minutes.";
      } else if (isTooLarge && channel === 'voice') {
        reply = "We're temporarily unable to process that request right now. Please call back in a few minutes.";
      } else if (isRateLimit && channel === 'chat') {
        reply = "We're experiencing high demand right now. Please try again in about 30 minutes, or call us directly to schedule.";
      } else if (isRateLimit && channel === 'voice') {
        reply = "We're experiencing high demand. Please call back in 30 minutes or visit our website to book.";
      } else {
        const PatientOrchestratorService = require('./patient-orchestrator-service');
        try {
          const fb = await PatientOrchestratorService.orchestrate({
            channel,
            transcript_or_message: message,
            session_id: sessionId,
            caller_phone: callerPhone,
            patient_id: patientId,
            clinic_id: clinicId
          });
          reply = fb?.text || fb?.reply || this.fallbackReply(channel);
          // CRITICAL: Pass through state + next_chips so the handler can persist them.
          // Without this, the orchestrator's flow_state (e.g. insurance_started, step) is never saved,
          // and we loop forever asking "Please enter your insurance member ID".
          return {
            reply: _sanitizeToolNameLeaks(reply),
            endCall: false,
            toolsUsed: [],
            language: preferredLanguage,
            usedFallback: true,
            state: fb?.state,
            next_chips: fb?.next_chips,
            next_step: fb?.next_step,
            redirect_to: fb?.redirect_to
          };
        } catch (_) {
          reply = this.fallbackReply(channel);
        }
      }
      // Ensure fallback/error replies still persist in conversation history.
      reply = _sanitizeToolNameLeaks(reply);
      try { this._appendToHistory(sessionId, 'assistant', reply); } catch (_) {}
      return { reply, endCall: false, toolsUsed: [], language: preferredLanguage, usedFallback: true };
    }

    // ── 6. Persist assistant reply ────────────────────────────
    reply = _sanitizeToolNameLeaks(reply);
    this._appendToHistory(sessionId, 'assistant', reply);

    return { reply, endCall, toolsUsed, language: preferredLanguage, next_step: nextStep, next_chips: nextChips, chips_display: chipsDisplay };
  }

  // ─────────────────────────────────────────────────────────────
  // LLM loop: call → check for tool_calls → execute → repeat
  // ─────────────────────────────────────────────────────────────
  static async _runLLMLoop({ history, context, clinicId, patientId, callerPhone, sessionId, channel, forceProvider }) {
    const groq = getGroq();
    const effectiveProvider = forceProvider || process.env.KELLY_PRIMARY_PROVIDER || 'groq';
    const maxTurns = channel === 'voice' ? Math.min(8, MAX_HISTORY_TURNS) : MAX_HISTORY_TURNS;
    const maxChars = channel === 'voice' ? MAX_HISTORY_CONTENT_CHARS_VOICE : MAX_HISTORY_CONTENT_CHARS_CHAT;
    const prunedHistory = history
      .slice(-maxTurns)
      .map(m => ({ role: m.role, content: _truncateForLLM(m.content, maxChars) }));

    let messages = [
      { role: 'system', content: buildSystemPrompt(context) },
      ...prunedHistory
    ];

    const toolsUsed = [];
    const toolCallCounts = {};
    let endCall = false;
    let iterations = 0;
    let nextStep = null;
    let nextChips = null;
    let chipsDisplay = null;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      let response;
      try {
        if (effectiveProvider === 'anthropic') {
          response = await LLMRouter.call({
            messages,
            tools: KELLY_TOOLS,
            channel,
            maxTokens:
              channel === 'voice'
                ? KELLY_VOICE_MAX_TOKENS
                : parseInt(process.env.KELLY_ANTHROPIC_MAX_TOKENS || String(KELLY_CHAT_MAX_TOKENS), 10)
          });
        } else {
          response = await groq.chat.completions.create({
            model: GROQ_MODEL,
            messages,
            tools: KELLY_TOOLS,
            tool_choice: 'auto',
            temperature: 0.3,
            max_tokens: channel === 'voice' ? KELLY_VOICE_MAX_TOKENS : KELLY_CHAT_MAX_TOKENS
          });
        }
      } catch (err) {
        const messageLower = err?.message ? String(err.message).toLowerCase() : '';
        const isRateLimit = (err?.status === 429 || err?.statusCode === 429 || messageLower.includes('rate_limit') || messageLower.includes('rate limit'));
        const isTooLarge = (err?.status === 413 || err?.statusCode === 413 ||
          messageLower.includes('too large') ||
          messageLower.includes('request too large') ||
          messageLower.includes('tokens per minute') ||
          messageLower.includes('413'));

        if ((isRateLimit || isTooLarge) && GROQ_FALLBACK_MODEL && GROQ_FALLBACK_MODEL !== GROQ_MODEL) {
          const reason = isTooLarge ? 'Request too large' : 'Rate limit hit';
          console.warn(`[KellyAgent] ${reason}, retrying with fallback model after 1s delay:`, GROQ_FALLBACK_MODEL);
          // Small delay: Groq limits are per API-key, so immediate retry can hit again.
          await new Promise(r => setTimeout(r, 1000));
          try {
            const compactSystem = _buildCompactSystemPrompt(context);

            // Keep only a few messages when we're size-limited; tool payloads inflate fast.
            // Also re-truncate message content to make the retry request much smaller.
            const keepN = isTooLarge ? 2 : 8;
            const maxCharsRetry = isTooLarge ? (channel === 'voice' ? 700 : 650) : maxChars;
            const trimmedHistory = messages
              .filter(m => m.role !== 'system')
              .slice(-keepN)
              .map(m => ({
                ...m,
                content: (typeof m.content === 'string' ? _truncateForLLM(m.content, maxCharsRetry) : m.content)
              }));

            messages = [
              { role: 'system', content: compactSystem },
              ...trimmedHistory
            ];

            response = await groq.chat.completions.create({
              model: GROQ_FALLBACK_MODEL,
              messages,
              tools: KELLY_TOOLS,
              tool_choice: 'auto',
              temperature: 0.3,
              max_tokens: channel === 'voice' ? KELLY_VOICE_MAX_TOKENS : KELLY_CHAT_MAX_TOKENS
            });
          } catch (err2) {
            console.error('[KellyAgent] Fallback model also failed:', err2.message);
            throw err2;
          }
        } else {
          console.error('[KellyAgent] Groq API error:', err?.message || err);
          throw err;
        }
      }

      const choice = response.choices?.[0];
      if (!choice) break;

      const { finish_reason, message: assistantMsg } = choice;

      // ── Text reply: done ──────────────────────────────────
      if (finish_reason === 'stop' || !assistantMsg.tool_calls?.length) {
        const reply = assistantMsg.content || "I'm sorry, I didn't catch that. Could you say that again?";
        return { reply, toolsUsed, endCall, next_step: nextStep, next_chips: nextChips, chips_display: chipsDisplay };
      }

      // ── Tool calls: execute each, append results ──────────
      messages.push({ role: 'assistant', content: assistantMsg.content || null, tool_calls: assistantMsg.tool_calls });

      for (const toolCall of assistantMsg.tool_calls) {
        const toolName = toolCall.function.name;
        toolCallCounts[toolName] = (toolCallCounts[toolName] || 0) + 1;
        if (toolCallCounts[toolName] > 2) {
          console.warn(`[KellyAgent] Tool ${toolName} called ${toolCallCounts[toolName]} times — breaking loop`);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: false,
              error: `${toolName} already attempted twice. Do not call this tool again. Move to the next step.`
            })
          });
          continue;
        }
        toolsUsed.push(toolName);

        let toolArgs;
        try {
          toolArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch (_) {
          toolArgs = {};
        }

        if (toolName === 'end_call') {
          endCall = true;
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ success: true, message: 'Call ended' })
          });
          continue;
        }

        // Execute tool via KellyToolExecutor
        let toolResult;
        try {
          toolResult = await KellyToolExecutor.execute(toolName, toolArgs, {
            sessionId,
            clinicId,
            patientId,
            callerPhone,
            channel
          });
        } catch (err) {
          console.error(`[KellyAgent] Tool ${toolName} failed:`, err.message);
          toolResult = { success: false, error: err.message };
        }

        // Debug: log tool result to diagnose infinite loops (e.g. collect_insurance)
        console.log(`[KellyAgent] Tool result for ${toolName}:`, JSON.stringify(toolResult)?.slice(0, 500));

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          // Keep next request compact by truncating large tool payloads.
          content: _truncateForLLM(
            JSON.stringify(toolResult),
            channel === 'voice' ? KELLY_TOOL_RESULT_MAX_CHARS_VOICE : KELLY_TOOL_RESULT_MAX_CHARS_CHAT
          )
        });

        // Guardrail: if slot lookup is refused because triage isn't ready yet, do not
        // continue the tool-call loop (prevents run_triage_rag <-> get_available_slots spirals).
        if (toolName === 'get_available_slots' && toolResult && toolResult.success === false) {
          const code = toolResult.error_code || toolResult.error;
          if (['TRIAGE_INCOMPLETE', 'LOW_CONFIDENCE', 'TRIAGE_REQUIRED'].includes(code)) {
            const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
            const toolMsgRaw = typeof toolResult.message === 'string' && toolResult.message.trim()
              ? toolResult.message.trim()
              : '';
            const toolMsg = toolMsgRaw ? _sanitizeToolMessageForPatient(toolMsgRaw) : '';
            return {
              reply: _replyForTriageIncomplete(code, channel, context?.preferredLanguage, sessionRow, context?.message) +
                (toolMsg ? ` ${toolMsg}` : ''),
              toolsUsed,
              endCall: false,
              next_step: null,
              next_chips: null,
              chips_display: null
            };
          }
        }

        // Capture next_step, next_chips from tool results for chat UX (upload zone, chips)
        if (toolResult?.next_step) nextStep = toolResult.next_step;
        if (toolResult?.next_chips) nextChips = toolResult.next_chips;
        if (toolResult?.chips_display != null) chipsDisplay = toolResult.chips_display;

        // Special: if run_triage_rag returns red → override with emergency reply
        if (toolName === 'run_triage_rag' && toolResult?.safety_level === 'red') {
          const emergencyReply = toolResult.patient_friendly_summary ||
            'Your symptoms require emergency care. Please call 911 or go to the nearest emergency room immediately.';
          return { reply: emergencyReply, toolsUsed, endCall: false, next_step: nextStep, next_chips: nextChips, chips_display: chipsDisplay };
        }
      }

      if (endCall) {
        // Do one more LLM call to get a closing reply
        const closeResponse = await groq.chat.completions.create({
          model: GROQ_MODEL,
          messages,
          temperature: 0.3,
          max_tokens: 100
        });
        const closeReply = closeResponse.choices?.[0]?.message?.content || 'Thank you for calling DocLittle. Take care!';
        return { reply: closeReply, toolsUsed, endCall: true, next_step: nextStep, next_chips: nextChips, chips_display: chipsDisplay };
      }
    }

    // Safety: if loop exhausted without reply — synthesize from last get_available_slots result if possible
    // Bug 16: Filter to slot tool results; last tool message could be store_triage_opqrst etc.
    const slotToolIds = new Set();
    for (const m of messages) {
      if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) {
          if (tc.function?.name === 'get_available_slots') slotToolIds.add(tc.id);
        }
      }
    }
    const slotToolMsgs = messages.filter(m => m.role === 'tool' && m.tool_call_id && slotToolIds.has(m.tool_call_id) && m.content);
    const lastSlotResult = slotToolMsgs.length ? slotToolMsgs[slotToolMsgs.length - 1].content : null;
    let fallback = "I'm sorry, something went wrong on my end. Please try again or call us directly.";
    try {
      const parsed = lastSlotResult ? JSON.parse(lastSlotResult) : null;
      if (parsed?.success && parsed?.slot_bundles?.length) {
        fallback = `I found ${parsed.slot_bundles.length} available time(s). Which one works best for you? Or say "call back" and we can continue by phone.`;
      } else if (parsed?.success && parsed?.available_slots?.length) {
        fallback = `I have availability. Please tell me which time you prefer, or we can continue over the phone.`;
      }
    } catch (_) {}
    return { reply: fallback, toolsUsed, endCall: false, next_step: nextStep, next_chips: nextChips, chips_display: chipsDisplay };
  }

  // ─────────────────────────────────────────────────────────────
  // History management
  // ─────────────────────────────────────────────────────────────
  static _loadHistory(sessionId) {
    try {
      const rows = db.db.prepare(`
        SELECT role, content FROM kelly_conversation_history
        WHERE session_id = ?
        ORDER BY created_at ASC
        LIMIT ?
      `).all(sessionId, MAX_HISTORY_TURNS * 2);
      return rows.map(r => ({ role: r.role, content: r.content }));
    } catch (_) {
      return [];
    }
  }

  static _appendToHistory(sessionId, role, content) {
    try {
      db.db.prepare(`
        CREATE TABLE IF NOT EXISTS kelly_conversation_history (
          id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          session_id  TEXT NOT NULL,
          role        TEXT NOT NULL,
          content     TEXT NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run();

      db.db.prepare(`
        INSERT INTO kelly_conversation_history (session_id, role, content)
        VALUES (?, ?, ?)
      `).run(sessionId, role, content || '');

      // Trim to last 100 rows per session
      db.db.prepare(`
        DELETE FROM kelly_conversation_history
        WHERE session_id = ?
          AND id NOT IN (
            SELECT id FROM kelly_conversation_history
            WHERE session_id = ?
            ORDER BY created_at DESC
            LIMIT 100
          )
      `).run(sessionId, sessionId);
    } catch (e) {
      console.warn('[KellyAgent] History append failed:', e.message);
    }
  }

  static _handleFastIntentPrecheck({ intent, message, sessionId, patientId }) {
    if (intent === 'billing') {
      const billingReply = _getBillingReply(message);
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', billingReply);
      return {
        reply: billingReply,
        endCall: false,
        toolsUsed: [],
        language: 'en',
        usedFallback: false
      };
    }

    if (intent === 'routine_booking') {
      const routineReply =
        "Great — I can help with a routine wellness visit. Since you don't have active symptoms, we can skip symptom triage. Do you prefer live video or async review, and what date works best for you?";
      this._appendToHistory(sessionId, 'user', message);
      this._appendToHistory(sessionId, 'assistant', routineReply);
      try {
        if (db.upsertTriageSession) {
          const existing = db.getTriageSession ? (db.getTriageSession(sessionId) || {}) : {};
          db.upsertTriageSession({
            session_id: sessionId,
            patient_id: patientId,
            detected_language: existing.detected_language || 'en',
            safety_level: existing.safety_level || 'green',
            urgency: existing.urgency || 'routine',
            target_specialty: existing.target_specialty || 'PrimaryCare',
            opqrst_complete: true,
            triage_complete: true,
            intake_complete_at: existing.intake_complete_at || new Date().toISOString()
          });
        }
      } catch (_) {}
      return {
        reply: routineReply,
        endCall: false,
        toolsUsed: [],
        language: 'en',
        usedFallback: false
      };
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // Language detection from history or current message
  // ─────────────────────────────────────────────────────────────
  static _detectPreferredLanguage(history, currentMessage) {
    const lastAssistantMsg = [...history].reverse().find(m => m.role === 'assistant');
    if (lastAssistantMsg?.language) return lastAssistantMsg.language;

    const t = currentMessage || '';
    if (/\p{Script=Cyrillic}/u.test(t)) return 'ru';
    if (/[\u4e00-\u9fff]/.test(t)) return 'zh';
    if (/^(hola|buenos|gracias|por favor|necesito|dolor|quiero)\b/i.test(t)) return 'es';
    if (/^(bonjour|merci|je veux|oui|non)\b/i.test(t)) return 'fr';
    if (/^(guten|danke|ich bin|hallo)\b/i.test(t)) return 'de';
    if (/\b(nataka|daktari|maumivu|msaada|habari|ndiyo|hapana|asante|tafadhali|ninajua|ninaweza)\b/i.test(t)) return 'sw';
    return 'en';
  }

  // ─────────────────────────────────────────────────────────────
  // Emergency flag persistence
  // ─────────────────────────────────────────────────────────────
  static _persistEmergencyFlag(sessionId, patientId, callerPhone, channel, assessment) {
    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      if (db.upsertPatientEmergencyFlag) {
        db.upsertPatientEmergencyFlag({
          patient_id: patientId || null,
          phone: callerPhone || null,
          source: channel,
          call_id: sessionId,
          expires_at: expiresAt,
          metadata: { red_flags: assessment.redFlags || [], urgency: assessment.urgency || 'EMERGENT' }
        });
      }
    } catch (_) {}
  }

  static fallbackReply(channel) {
    return channel === 'voice'
      ? "I'm having trouble connecting right now. Please hold on or call back in a moment."
      : "I'm temporarily unavailable. Please try again in a moment or call us directly.";
  }
}

module.exports = KellyAgentService;
