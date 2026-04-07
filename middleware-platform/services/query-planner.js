const TriageRAGServiceV2 = require('./triage-rag-service-v2');
const TriageRAGService = require('./triage-rag-service');
const PatientRecordsQueryService = require('./patient-records-query-service');
const MedicalLiteratureSearchService = require('./medical-literature-search-service');

function buildTypedQueryPlan({ message = '', state = {}, pathway = 'triage' } = {}) {
  const text = String(message || '').trim();
  const needsRecords = /\b(record|lab|result|report|my records|my labs|visit note)\b/i.test(text);
  const needsEvidence = /\b(study|evidence|research|pmid|paper|literature)\b/i.test(text);
  const needsService = /\b(book|appointment|doctor|specialist|slot|schedule)\b/i.test(text);
  const needsIngredient = /\b(ingredient|inci|product|cleanser|serum|moisturizer|cosmetic)\b/i.test(text);

  return {
    pathway,
    query_id: `qp-${Date.now()}`,
    subqueries: {
      pathology: {
        type: 'pathology',
        enabled: true,
        objective: 'derive specialty/urgency/safety from structured symptom context'
      },
      ingredient: {
        type: 'ingredient',
        enabled: needsIngredient,
        objective: 'resolve product/ingredient function and regulatory constraints'
      },
      case_pattern: {
        type: 'case_pattern',
        enabled: false,
        objective: 'retrieve de-identified similar prior cases'
      },
      service_option: {
        type: 'service_option',
        enabled: needsService,
        objective: 'route to booking/care options based on pathway and risk'
      },
      records: {
        type: 'records',
        enabled: needsRecords,
        objective: 'answer patient questions from uploaded records'
      },
      literature: {
        type: 'literature',
        enabled: needsEvidence,
        objective: 'retrieve medical literature references'
      }
    },
    state_hint: {
      chief_complaint: state?.chief_complaint || null,
      body_sites: Array.isArray(state?.body_sites) ? state.body_sites : [],
      severity: state?.severity ?? null,
      timeline: state?.timeline || null,
      risk_flags: Array.isArray(state?.risk_flags) ? state.risk_flags : []
    }
  };
}

async function runPathologyRetrieval({ sessionId, symptomText, opqrst = {}, richIntake = {}, patientId = null, clinicId = null } = {}) {
  const text = String(symptomText || '').trim();
  if (!text) return { success: false, error: 'symptom_text_required', confidence: null };
  try {
    const out = await TriageRAGServiceV2.enrichFromStructuredInput({
      sessionId,
      symptomText: text,
      opqrst,
      richIntake,
      patientId,
      clinicId
    });
    return {
      success: true,
      source: 'triage_rag_v2',
      confidence: out?.rag_confidence ?? null,
      specialty: out?.target_specialty || out?.specialty || null,
      urgency: out?.urgency || null,
      safety_level: out?.safety_level || null,
      data: out
    };
  } catch (e) {
    const fallback = TriageRAGService.getLatestForSession ? TriageRAGService.getLatestForSession(sessionId) : null;
    return {
      success: !!fallback,
      source: 'triage_rag_latest_fallback',
      confidence: fallback?.rag_confidence ?? null,
      specialty: fallback?.target_specialty || null,
      urgency: fallback?.urgency || null,
      safety_level: fallback?.safety_level || null,
      data: fallback,
      error: fallback ? null : e.message
    };
  }
}

async function runRecordsRetrieval({ patientId, query }) {
  return PatientRecordsQueryService.queryPatientRecords(patientId, query);
}

async function runLiteratureRetrieval({ query, max_results, sessionId }) {
  return MedicalLiteratureSearchService.searchPubMed(query, { max_results, sessionId });
}

function resolveServiceOption({ plan, safetyStatus = 'green', preferred = 'care_guidance' } = {}) {
  if (safetyStatus === 'red') {
    return {
      route: 'safety_override',
      allowed_actions: ['doctor_needed'],
      suppress_commercial: true
    };
  }
  if (plan?.subqueries?.service_option?.enabled) {
    return {
      route: 'service_option',
      allowed_actions: ['doctor_needed', 'care_guidance'],
      suppress_commercial: false
    };
  }
  return {
    route: preferred,
    allowed_actions: [preferred],
    suppress_commercial: false
  };
}

module.exports = {
  buildTypedQueryPlan,
  runPathologyRetrieval,
  runRecordsRetrieval,
  runLiteratureRetrieval,
  resolveServiceOption
};
