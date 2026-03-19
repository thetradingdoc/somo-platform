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
const db = require('../database');
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
const MAX_HISTORY_CONTENT_CHARS_CHAT = parseInt(process.env.KELLY_HISTORY_CONTENT_CHARS_CHAT || '2000', 10);

function _truncateForLLM(content, maxChars) {
  const s = content == null ? '' : String(content);
  if (!maxChars || s.length <= maxChars) return s;
  return s.slice(0, maxChars) + '…';
}

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
- Forbidden tools: get_available_slots, collect_insurance, schedule_appointment, create_appointment_checkout, verify_checkout_code.

### State B: Triage-in-progress
- Allowed tools: store_triage_opqrst, store_triage_rich_intake, get_triage_session, run_triage_rag, request_document_upload.
- Forbidden tools: get_available_slots, collect_insurance, schedule_appointment, create_appointment_checkout, verify_checkout_code.

### State C: Triage-complete
- Allowed tools: get_available_slots → collect_insurance → schedule_appointment → payment tools.
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
- **Rashes / skin**
  - Severity 1–10 = itch/burning intensity and/or extent (small patch = low; rapidly spreading, painful, blistering = high).
  - Radiation = does it spread to other body areas?
  - Provocation = new skincare products, exposures, new meds, allergens.
- **Fatigue / endocrine**
  - Severity 1–10 = impact on daily function (able to do normal activities = low; unable to function = high).
  - Quality = tiredness vs weakness vs sleepiness; any heat/cold intolerance if relevant.
  - Radiation = does it affect multiple systems (sleep, energy, weight change)?
- **Respiratory (breathing/cough)**
  - Severity 1–10 = breathing difficulty and how limited you are (mild cough = low; cannot speak full sentences or severe breathlessness = high).
  - Quality = dry vs wheezy vs wet cough; tightness/pressure feeling.
  - Timing = how long the breathing symptom has lasted and whether it’s constant or comes/goes.
- **Psychiatry**
  - Severity 1–10 = distress/impairment (how hard it is to function), and you must still run the Safety Screen when mental health is in scope.

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
- Chest/heart symptoms → Cardiology
- Skin rashes, lesions → Dermatology
- Mental health, mood, anxiety → Psychiatry
- Bone/joint/back → Orthopedics
- Headache, seizure, numbness → Neurology
- Breathing, cough → Pulmonology
- General/routine → Primary Care

## Document/Image Upload (gap10: pause-resume)
If the patient mentions a rash, skin condition, ECG result, lab result, or any visual symptom:
- Call request_document_upload with the reason (e.g. "skin rash photo", "ECG report")
- Halt the triage flow until they upload — say: "I'll pause here. Please upload your [reason] using the button. Once you've uploaded, tell me and we'll continue."
- When they say "I've uploaded" or similar:
  - Call get_triage_session first and check upload state:
    - If media_received is 1 (or true): do NOT request upload again; continue OPQRST/rich intake collection if anything is still missing.
    - If media_received is 0 (or false): request_document_upload again (the patient may not have uploaded successfully yet).
  - After you have an uploaded state (media_received=1), call run_triage_rag again with full context (including uploaded content).
  - Only after triage-complete can you proceed to get_available_slots and scheduling.
- For voice: "I'll send you a link to upload your documents."

## Patient Records (M-Doc.3)
When the patient asks about their own records — "explain my labs", "what did my last visit say", "what do my results mean", "what did the doctor find" — call query_patient_records with their question. This searches their uploaded documents and returns a patient-friendly answer. If they have no documents yet, explain they can upload and ask again.

Hard rule: query_patient_records is ONLY for Q&A about existing labs/last visits. Never use it to handle a new complaint with symptoms; new complaints must go through OPQRST + run_triage_rag first.

## Async vs Sync UX Script (gap9)
When offering options, explain the tradeoff:
- **Async** (specialist review, photos/docs): Lower cost, typically 4–24 hours response. "You can submit your info and photos; a specialist will review within a few hours. It's less expensive."
- **Sync** (live video): Higher cost, immediate. "Or we can schedule a live video visit for a higher fee but you'll speak directly with the specialist."
Say: "Would you prefer the lower-cost review within a few hours, or a live video visit today?"

## Booking Flow (gap15: insurance after triage)
1. Collect patient name (if not known)
2. Complete triage with run_triage_rag first
3. Ask for insurance member ID — collect_insurance requires triage (uses RAG CPT code)
4. Confirm insurance with collect_insurance tool
5. Find available slots with get_available_slots (MUST run triage first; pass specialty from run_triage_rag)
6. If kelly_script is in the slot result, say it to the patient (e.g. language match decay)
6b. If the slot result includes secondary_specialties, offer an optional additional review for those secondary specialties after the primary visit (ask which they want).
7. Confirm slot with patient
8. Collect email
9. Schedule with schedule_appointment (practitioner_id from the slot is REQUIRED)
10. Handle payment

## gap12: Before run_triage_rag — assemble OPQRST from session
Call get_triage_session first. Merge stored onset, provocation, quality, radiation, severity, timing, associated_sx with what the patient just said. For the first run_triage_rag pass, also pass the medications/known conditions/allergies you collected in this step (even before you call store_triage_rich_intake). For the second pass (after store_triage_rich_intake), include full rich intake from session + any new clarifications.

Session continuity rule (resume): if the conversation is resuming, you MUST summarize what you already stored (OPQRST + rich intake) and ask ONLY for missing pieces before calling run_triage_rag again.

## critical_unknowns (M-S1.D)
When run_triage_rag returns critical_unknowns (e.g. "alcohol history", "CAGE not done"), ask those questions before routing. Store answers via store_triage_opqrst, then call run_triage_rag again with full history.

## gap13: Low RAG confidence
If run_triage_rag returns rag_confidence < 0.7, ask ONE more clarifying question (e.g. "Can you describe the pain in more detail?" or "Is it on both sides or one side?") before routing. Do not proceed to get_available_slots until confidence is ≥0.7 or the patient has no more to add.

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
  {
    type: 'function',
    function: {
      name: 'collect_insurance',
      description: 'Check patient insurance. REQUIRES run_triage_rag first (we use RAG CPT code, not default). Call after triage completes.',
      parameters: {
        type: 'object',
        properties: {
          member_id: { type: 'string', description: 'Insurance member ID' },
          patient_name: { type: 'string', description: 'Full patient name' },
          patient_phone: { type: 'string', description: 'Patient phone number' },
          patient_email: { type: 'string', description: 'Patient email address' },
          payer_name: { type: 'string', description: 'Insurance company name (e.g. Cigna, Aetna)' },
          service_code: { type: 'string', description: 'CPT code for the service type' }
        },
        required: ['member_id', 'patient_name']
      }
    }
  },
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
          alcohol_cage_score: { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'CAGE-4 score 0-4 (2+ = positive)' },
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
          session_id: { type: 'string', description: 'Current session_id (optional; use context if omitted)' },
          medications: { type: 'array', items: { type: 'string' }, description: 'Medications list' },
          allergies: { type: 'array', items: { type: 'string' }, description: 'Allergies list' },
          prior_diagnoses: { type: 'array', items: { type: 'string' }, description: 'Known conditions list' },
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
          alcohol_cage_score: { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'CAGE-4 score 0-4' },
          safety_screen: { type: 'string', description: 'positive if safety screen yes; negative otherwise' }
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
    const context = { channel, clinicId, patientId, patientName, callerPhone, preferredLanguage, sessionId };

    // ── 4. Append user message ────────────────────────────────
    this._appendToHistory(sessionId, 'user', message);
    history.push({ role: 'user', content: message });

    // ── 5. Call LLM with tool loop ────────────────────────────
    let reply, toolsUsed = [], endCall = false, nextStep, nextChips, chipsDisplay;
    try {
      const loopResult = await this._runLLMLoop({
        history,
        context,
        clinicId,
        patientId,
        callerPhone,
        sessionId,
        channel
      });
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
          if (triageOut?.patient_friendly_summary) reply = triageOut.patient_friendly_summary;
          else if (triageOut?.suggested_next_step) reply = triageOut.suggested_next_step;
          else reply = 'Thanks for the upload. Let’s continue triage now.';
          toolsUsed = Array.isArray(toolsUsed) ? [...toolsUsed, 'run_triage_rag'] : ['run_triage_rag'];
        }
      } catch (guardErr) {
        // If the guard fails, keep original LLM reply.
      }
    } catch (err) {
      console.error('[KellyAgent] LLM loop failed:', err.message);
      const isRateLimit = err.status === 429 || err.statusCode === 429 ||
        (err.message && String(err.message).includes('429')) ||
        (err.message && String(err.message).toLowerCase().includes('rate_limit'));
      if (isRateLimit && channel === 'chat') {
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
        } catch (_) {
          reply = this.fallbackReply(channel);
        }
      }
      return { reply, endCall: false, toolsUsed: [], language: preferredLanguage, usedFallback: true };
    }

    // ── 6. Persist assistant reply ────────────────────────────
    this._appendToHistory(sessionId, 'assistant', reply);

    return { reply, endCall, toolsUsed, language: preferredLanguage, next_step: nextStep, next_chips: nextChips, chips_display: chipsDisplay };
  }

  // ─────────────────────────────────────────────────────────────
  // LLM loop: call → check for tool_calls → execute → repeat
  // ─────────────────────────────────────────────────────────────
  static async _runLLMLoop({ history, context, clinicId, patientId, callerPhone, sessionId, channel }) {
    const groq = getGroq();
    const maxTurns = channel === 'voice' ? Math.min(8, MAX_HISTORY_TURNS) : MAX_HISTORY_TURNS;
    const maxChars = channel === 'voice' ? MAX_HISTORY_CONTENT_CHARS_VOICE : MAX_HISTORY_CONTENT_CHARS_CHAT;
    const prunedHistory = history
      .slice(-maxTurns)
      .map(m => ({ role: m.role, content: _truncateForLLM(m.content, maxChars) }));

    const messages = [
      { role: 'system', content: buildSystemPrompt(context) },
      ...prunedHistory
    ];

    const toolsUsed = [];
    let endCall = false;
    let iterations = 0;
    let nextStep = null;
    let nextChips = null;
    let chipsDisplay = null;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      let response;
      try {
        response = await groq.chat.completions.create({
          model: GROQ_MODEL,
          messages,
          tools: KELLY_TOOLS,
          tool_choice: 'auto',
          temperature: 0.3,       // Lower = more consistent medical responses
          max_tokens: channel === 'voice' ? KELLY_VOICE_MAX_TOKENS : KELLY_CHAT_MAX_TOKENS
        });
      } catch (err) {
        const isRateLimit = (err.status === 429 || (err.message && String(err.message).includes('rate_limit')));
        if (isRateLimit && GROQ_FALLBACK_MODEL && GROQ_FALLBACK_MODEL !== GROQ_MODEL) {
          console.warn('[KellyAgent] Rate limit hit, retrying with fallback model after 1s delay:', GROQ_FALLBACK_MODEL);
          // Bug 15: Add delay — Groq rate limits are per-API-key; immediate retry hits same limit
          await new Promise(r => setTimeout(r, 1000));
          try {
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
          console.error('[KellyAgent] Groq API error:', err.message);
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

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult)
        });

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
