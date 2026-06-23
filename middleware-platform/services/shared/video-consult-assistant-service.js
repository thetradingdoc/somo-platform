/**
 * Video Consult Assistant Service
 * Generates a compact assistant view for the provider overlay:
 * - summary
 * - key_problems
 * - followups
 * - risk_flags
 * - codes (icd10 / cpt / hcpcs from Layer 2 RAG, when available)
 */

const Groq = require('groq-sdk');
const videoConsultService = require('./video-consult-service');
const knowledgeService = require('./knowledge-service');
const db = require('../../database');
const {
  listChecklistBySession,
  listVisionArtifactsBySession
} = require('./vision-capture-store');
const {
  translateVisionSignals,
  gateIcdSuggestionsByVisionConfidence
} = require('./vision-symptom-mapper');

const groqApiKey = process.env.GROQ_API_KEY;
const groqClient = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null;

function buildTranscriptContext(transcript, maxChars = 2500) {
  if (!Array.isArray(transcript) || transcript.length === 0) return '';
  const lines = transcript.map((t) => {
    if (!t) return '';
    const speaker = t.speaker || 'unknown';
    const text =
      typeof t === 'string'
        ? t
        : t.text || t.content || '';
    if (!text) return '';
    return `${speaker}: ${text}`;
  }).filter(Boolean);
  const joined = lines.join('\n');
  return joined.slice(0, maxChars);
}

async function getRagCodes(clinicalText, specialtyTag, visionMap = null) {
  try {
    const retrievalInput = [clinicalText, visionMap?.retrieval_text].filter(Boolean).join('\n');
    const dual = await knowledgeService.getCodeCandidatesDualSource(retrievalInput || clinicalText, {
      specialty: specialtyTag || 'general',
      maxIcd10: 15,
      maxCpt: 10,
      maxHcpcs: 8
    });
    return {
      icd10: gateIcdSuggestionsByVisionConfidence(dual.icd10 || [], visionMap),
      cpt: dual.cpt || [],
      hcpcs: dual.hcpcs || [],
      vision_symptoms: visionMap?.symptom_terms || []
    };
  } catch (e) {
    console.warn('[video-consult-assistant] RAG failed:', e.message);
    return { icd10: [], cpt: [], hcpcs: [] };
  }
}

async function summarizeWithGroq(transcriptText, ragCodes, preVisit = null, extraContext = {}) {
  const preVisitText =
    preVisit?.case_summary_brief?.soap_note_short ||
    preVisit?.case_summary_brief?.chief_complaint ||
    preVisit?.triage_session?.soap_note ||
    '';

  if (!groqClient || (!transcriptText.trim() && !preVisitText.trim())) {
    return null;
  }

  const systemPrompt = `
You are a clinical copilot summarizing a telehealth video visit for a clinician.

Input:
- Pre-visit context (triage + short case summary + document index). This is authoritative baseline.
- Treat it as the starting clinical picture. Do not contradict it unless the transcript provides clear evidence.
- Speaker-labelled transcript snippets from the consult.
- Optional candidate ICD-10/CPT/HCPCS codes from a RAG system.

Output:
Return STRICT JSON ONLY with this shape:
{
  "summary": "1-2 sentence high-level summary.",
  "chief_complaint": "string",
  "key_problems": ["problem 1", "problem 2"],
  "followups": ["short question the clinician should still ask", "..."],
  "safety_flags": ["any safety-related concerns you can justify from pre-visit/triage", "..."],
  "risk_flags": ["any red-flag concerns from pre-visit and/or transcript, or empty array"],
  "doc_citations": [{"doc_id": "string", "doc_title": "string", "reason": "string"}],
  "codes": {
    "icd10": [{"code": "R51.9", "description": "..."}],
    "cpt":   [{"code": "99213", "description": "..."}],
    "hcpcs": []
  }
}

Doc citations:
- Only cite documents that exist in PRE_VISIT.document_index.
- If you cannot ground a statement to a document, return doc_citations as an empty array.

Keep each list to at most 5 items. If unsure, use empty arrays.
`;

  const ragSnippet = JSON.stringify(ragCodes || {}, null, 2);
  const userPrompt = `
<PRE_VISIT>
${JSON.stringify(preVisit || {}, null, 2)}
</PRE_VISIT>

<TRANSCRIPT>
${transcriptText}
</TRANSCRIPT>

<RAG_CODES>
${ragSnippet}
</RAG_CODES>

Return JSON ONLY.`;

  try {
    const completion = await groqClient.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const content = completion.choices[0]?.message?.content || '';
    if (!content) return null;
    try {
      const parsed = JSON.parse(content);
      return parsed;
    } catch (e) {
      console.warn('[video-consult-assistant] Failed to parse Groq JSON:', e.message);
      return null;
    }
  } catch (e) {
    console.warn('[video-consult-assistant] Groq summarization failed:', e.message);
    return null;
  }
}

/**
 * Map raw YOLO classes to clinical findings (human-readable labels).
 * Extend as custom/clinical models are added.
 */
const YOLO_TO_CLINICAL = {
  person: { finding: 'Person detected', clinical: true },
  face: { finding: 'Face detected', clinical: true },
  wound: { finding: 'Possible wound', clinical: true },
  cell_phone: { finding: 'Device present', clinical: false },
  book: { finding: 'Object present', clinical: false },
  bottle: { finding: 'Object present', clinical: false }
};

function mapYoloToClinical(className, confidence) {
  const key = (className || '').toLowerCase().replace(/\s+/g, '_');
  const mapped = YOLO_TO_CLINICAL[key] || { finding: className || 'Unknown', clinical: true };
  return {
    finding: mapped.finding,
    confidence,
    raw_class: className,
    is_clinical: mapped.clinical
  };
}

function mapVisionDetectionsToTags(detections) {
  const list = Array.isArray(detections) ? detections : [];
  return list
    .map((d) => mapYoloToClinical(d?.class || d?.name || 'unknown', d?.confidence || d?.conf || 0))
    .filter((d) => d && d.is_clinical)
    .map((d) => ({
      finding: d.finding,
      confidence: d.confidence,
      raw_class: d.raw_class,
      is_clinical: d.is_clinical
    }));
}

/**
 * Extract unique YOLO detections from recent frames, mapped to clinical findings.
 */
function extractYoloDetections(frames) {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  
  const detectionMap = new Map(); // class -> { count, confidence }
  
  frames.forEach(frame => {
    if (!frame.yolo_detections) return;
    const detections = Array.isArray(frame.yolo_detections) 
      ? frame.yolo_detections 
      : (frame.yolo_detections.detections || []);
    
    detections.forEach(det => {
      const className = det.class || det.name || 'unknown';
      const conf = det.confidence || det.conf || 0;
      
      if (conf < 0.3) return; // Filter low confidence
      
      const existing = detectionMap.get(className);
      if (!existing || conf > existing.confidence) {
        detectionMap.set(className, {
          class: className,
          confidence: conf,
          count: (existing?.count || 0) + 1
        });
      } else {
        existing.count++;
      }
    });
  });
  
  // Sort by count (most frequent) and confidence, map to clinical, return top 5
  return Array.from(detectionMap.values())
    .sort((a, b) => b.count - a.count || b.confidence - a.confidence)
    .slice(0, 5)
    .map((d) => {
      const clinical = mapYoloToClinical(d.class, d.confidence);
      return { ...clinical, count: d.count, class: d.class };
    });
}

/**
 * Build assistant view for a room.
 */
async function getAssistantView(roomId) {
  const state = await videoConsultService.getSessionState(roomId);
  const transcript = state.transcript || [];
  const findings = state.findings || [];
  const status = state.status || 'unknown';

  // Fetch recent YOLO frames (last 30 frames, last 5 minutes)
  let yoloFrames = [];
  let yoloDetections = [];
  try {
    yoloFrames = db.getVideoConsultFrames(roomId) || [];
    // Filter to recent frames (last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const recentFrames = yoloFrames.filter(f => 
      f.timestamp && f.timestamp >= fiveMinutesAgo
    ).slice(-30); // Last 30 frames
    
    yoloDetections = extractYoloDetections(recentFrames);
  } catch (e) {
    console.warn('[video-consult-assistant] Failed to fetch YOLO frames:', e.message);
  }

  const transcriptText = buildTranscriptContext(transcript);
  // Prefer merged codes from session (set after end_session) over live RAG-only fetch
  const sessionMeta = state.session?.metadata || {};
  const preVisit = sessionMeta?.pre_visit || null;
  const shortTermThread = Array.isArray(sessionMeta?.short_term_thread) ? sessionMeta.short_term_thread : [];
  const storedRag = sessionMeta.rag_context;
  const mergedCodesFromSession =
    storedRag && (storedRag.icd10?.length || storedRag.cpt?.length || storedRag.hcpcs?.length)
      ? { icd10: storedRag.icd10 || [], cpt: storedRag.cpt || [], hcpcs: storedRag.hcpcs || [] }
      : null;

  const preVisitText =
    preVisit?.case_summary_brief?.soap_note_short ||
    preVisit?.case_summary_brief?.chief_complaint ||
    preVisit?.triage_session?.soap_note ||
    '';

  const ragInputText = [preVisitText, transcriptText].filter(Boolean).join('\n\n');

  const visionSessionId = roomId;
  const checklist = listChecklistBySession(visionSessionId);
  const artifacts = listVisionArtifactsBySession(visionSessionId);
  const regionCoverageMap = {};
  (checklist || []).forEach((r) => {
    regionCoverageMap[r.requested_region] = r.status;
  });
  const bestFramesByRegion = {};
  (artifacts || []).forEach((a) => {
    if (!bestFramesByRegion[a.requested_region]) {
      bestFramesByRegion[a.requested_region] = a.frame_url;
    }
  });
  const qualityNotes = (artifacts || []).map((a) => ({
    region: a.requested_region,
    quality_score: a.quality_score,
    quality_band: a.quality_band
  }));
  const reviewRequiredFlags = (artifacts || [])
    .filter((a) => Number(a.provider_review_required) === 1)
    .map((a) => a.requested_region);

  const visionHandoff = {
    region_coverage_map: regionCoverageMap,
    best_frames_by_region: bestFramesByRegion,
    quality_notes: qualityNotes,
    review_required_flags: [...new Set(reviewRequiredFlags)],
    checklist_rows: (checklist || []).map((r) => ({
      requested_region: r.requested_region,
      status: r.status,
      attempts: Number(r.attempts || 0),
      quality_score: r.quality_score == null ? null : Number(r.quality_score),
      provider_review_required: Number(r.provider_review_required) === 1
    })),
    accepted_frames: (artifacts || []).map((a) => ({
      requested_region: a.requested_region,
      frame_url: a.frame_url,
      quality_band: a.quality_band || null,
      quality_score: a.quality_score == null ? null : Number(a.quality_score),
      provider_review_required: Number(a.provider_review_required) === 1
    }))
  };
  const visionSymptomMap = translateVisionSignals({
    detections: yoloDetections,
    checklistRows: visionHandoff.checklist_rows
  });

  if (!transcriptText && yoloDetections.length === 0 && !preVisitText) {
    return {
      room_id: roomId,
      status,
      summary: '',
      key_problems: [],
      followups: [],
      risk_flags: [],
      codes: mergedCodesFromSession || { icd10: [], cpt: [], hcpcs: [] },
      findings,
      transcript_preview: [],
      yolo_tracking: yoloDetections,
      yolo_frame_count: yoloFrames.length,
      vision_handoff: visionHandoff,
      short_term_thread: shortTermThread.slice(-20)
    };
  }

  const specialtyTag = findings?.specialty_tag || 'general';
  const codes = mergedCodesFromSession || (await getRagCodes(ragInputText || transcriptText, specialtyTag, visionSymptomMap));
  const llmView = await summarizeWithGroq(transcriptText, codes, preVisit, { status, roomId });

  const lastMessages = transcript.slice(-4).map((t) => ({
    speaker: t.speaker || 'unknown',
    text: typeof t === 'string' ? t : (t.text || t.content || ''),
    timestamp: t.timestamp,
  }));

  if (llmView) {
    return {
      room_id: roomId,
      status,
      summary: llmView.summary || '',
      chief_complaint: llmView.chief_complaint || preVisit?.case_summary_brief?.chief_complaint || '',
      key_problems: Array.isArray(llmView.key_problems) ? llmView.key_problems : [],
      followups: Array.isArray(llmView.followups) ? llmView.followups : [],
      safety_flags: Array.isArray(llmView.safety_flags) ? llmView.safety_flags : [],
      risk_flags: Array.isArray(llmView.risk_flags) ? llmView.risk_flags : [],
      doc_citations: Array.isArray(llmView.doc_citations) ? llmView.doc_citations : [],
      codes: llmView.codes || codes || { icd10: [], cpt: [], hcpcs: [] },
      findings,
      transcript_preview: lastMessages,
      yolo_tracking: yoloDetections,
      vision_symptom_map: visionSymptomMap,
      yolo_frame_count: yoloFrames.length,
      vision_handoff: visionHandoff,
      short_term_thread: shortTermThread.slice(-20)
    };
  }

  // Fallback: simple heuristic summary when LLM unavailable
  return {
    room_id: roomId,
    status,
    summary: (transcriptText || preVisitText).slice(0, 240),
    chief_complaint: preVisit?.case_summary_brief?.chief_complaint || '',
    key_problems: Array.isArray(preVisit?.case_summary_brief?.key_problems)
      ? preVisit.case_summary_brief.key_problems
      : [],
    safety_flags: (() => {
      const sf = preVisit?.safety_flags;
      if (!sf) return [];
      const out = [];
      if (sf.safety_level) out.push(`safety_level:${sf.safety_level}`);
      if (sf.urgency) out.push(`urgency:${sf.urgency}`);
      if (sf.referred_to_911) out.push('referred_to_911');
      return out;
    })(),
    followups: [],
    risk_flags: [],
    doc_citations: [],
    codes: codes || { icd10: [], cpt: [], hcpcs: [] },
    findings,
    transcript_preview: lastMessages,
    yolo_tracking: yoloDetections,
    vision_symptom_map: visionSymptomMap,
    yolo_frame_count: yoloFrames.length,
    vision_handoff: visionHandoff,
    short_term_thread: shortTermThread.slice(-20)
  };
}

module.exports = {
  getAssistantView,
  mapYoloToClinical,
  mapVisionDetectionsToTags,
};

