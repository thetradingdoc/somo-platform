import { useState, useEffect, useRef } from 'react';

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');

function shapeCodes(results) {
  const typePalette = {
    Procedure: '#5d84c4',
    Diagnosis: '#c7904e',
    Symptom: '#7a62b1',
    Lab: '#5ea8b5'
  };
  const urgencyFor = (score) => {
    const n = Number(score);
    if (!Number.isFinite(n)) return 'Routine';
    if (n >= 0.82) return 'Priority';
    if (n >= 0.63) return 'Important';
    return 'Routine';
  };
  const normalizeScore = (score) => {
    const n = Number(score);
    if (!Number.isFinite(n)) return 0.52;
    if (n > 1) return Math.max(0, Math.min(1, n / 100));
    return Math.max(0, Math.min(1, n));
  };
  const safeText = (v, fallback) => {
    const s = String(v || '').trim();
    return s || fallback;
  };
  const summarize = (label, type) => {
    if (type === 'Diagnosis') return `${label} is a diagnosis term used to describe a health condition.`;
    if (type === 'Procedure') return `${label} is a procedure code used for visit and treatment billing.`;
    if (type === 'Symptom') return `${label} describes what a patient is currently feeling or experiencing.`;
    if (type === 'Lab') return `${label} is commonly associated with testing or diagnostic workflow.`;
    return `${label} is a medical ontology concept.`;
  };
  const nextStepForType = (type) => {
    if (type === 'Procedure') return 'Ask your care team when this procedure is appropriate and whether prep is required.';
    if (type === 'Lab') return 'Confirm if this test should be ordered now or after your consultation.';
    if (type === 'Symptom') return 'Track onset, triggers, and severity so triage can route you faster.';
    return 'Review likely causes with a clinician and confirm the safest treatment plan.';
  };

  const withMeta = (entry, type) => {
    const code = safeText(entry.code || entry.id || entry, '—');
    const label = safeText(entry.description || entry.display || entry.title || entry.label || code, 'No title');
    const confidenceRaw = entry.confidence ?? entry.score ?? null;
    const relevance = normalizeScore(confidenceRaw);
    return {
      id: safeText(entry.id || code, code),
      code,
      label,
      category: type,
      type,
      codingSystem: safeText(entry.system || entry.coding_system, type === 'Procedure' ? 'CPT' : 'ICD-10'),
      source: safeText(entry.source, 'ontology'),
      confidence: confidenceRaw,
      relevance,
      urgency: urgencyFor(relevance),
      summary: safeText(entry.summary || entry.blurb, summarize(label, type)),
      nextStep: safeText(entry.next_step || entry.nextStep, nextStepForType(type)),
      related: Array.isArray(entry.related) ? entry.related.slice(0, 3) : [],
      color: typePalette[type] || '#C7D2FE'
    };
  };

  const icd = (results.icd10 || []).map((c) => withMeta(c, 'Diagnosis'));
  const cpt = (results.cpt || []).map((c) => withMeta(c, 'Procedure'));
  const symptom = (results.symptoms || []).map((c) => withMeta(c, 'Symptom'));
  const hcpcs = (results.hcpcs || []).map((c) => withMeta(c, 'Lab'));
  return [...icd, ...cpt, ...symptom, ...hcpcs];
}

export function useRAGSearch() {
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [empty, setEmpty] = useState(false);
  const timerRef = useRef(null);
  const failureCountRef = useRef(0);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!query || query.trim().length < 2) {
      setCards([]);
      setLoading(false);
      setError(null);
      setEmpty(false);
      return;
    }

    setLoading(true);
    setError(null);
    setEmpty(false);
    const q = query.trim();

    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/rag/search?q=${encodeURIComponent(q)}&limit=20`,
          { headers: { 'ngrok-skip-browser-warning': 'true' } }
        );
        if (!res.ok) {
          throw new Error(`Search failed: ${res.status}`);
        }
        const data = await res.json();
        const shaped = shapeCodes(data || {});
        setCards(shaped);
        setEmpty(shaped.length === 0);
        failureCountRef.current = 0;
      } catch (e) {
        failureCountRef.current += 1;
        if (process.env.NODE_ENV === 'development') {
          console.error('[RAG_SEARCH_ERROR]', {
            message: e.message,
            query: q,
            failures: failureCountRef.current
          });
        }
        setError(
          failureCountRef.current >= 3
            ? 'Search is temporarily unavailable. Showing default cards.'
            : 'We could not reach search right now. Please try again.'
        );
        setCards([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  }, [query]);

  return { query, setQuery, cards, loading, error, empty };
}

