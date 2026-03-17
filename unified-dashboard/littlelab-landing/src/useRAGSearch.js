import { useState, useEffect, useRef } from 'react';

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');

function shapeCodes(results) {
  const cards = [];

  const icd = (results.icd10 || []).map((c) => ({
    id: c.code || c.id || c,
    code: c.code || c.id || c,
    label: c.description || c.display || c.title || c.code || c,
    category: 'Diagnosis',
    confidence: c.confidence || c.score || null,
    color: '#2D6A4F'
  }));

  const cpt = (results.cpt || []).map((c) => ({
    id: c.code || c.id || c,
    code: c.code || c.id || c,
    label: c.description || c.display || c.title || c.code || c,
    category: 'Procedure',
    confidence: c.confidence || c.score || null,
    color: '#1B4F72'
  }));

  const hcpcs = (results.hcpcs || []).map((c) => ({
    id: c.code || c.id || c,
    code: c.code || c.id || c,
    label: c.description || c.display || c.title || c.code || c,
    category: 'Supply',
    confidence: c.confidence || c.score || null,
    color: '#6D4C41'
  }));

  return [...icd, ...cpt, ...hcpcs];
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
        console.error('[RAG_SEARCH_ERROR]', {
          message: e.message,
          query: q,
          failures: failureCountRef.current
        });
        setError(
          failureCountRef.current >= 3
            ? 'Search is temporarily unavailable. Showing default cards.'
            : 'We could not reach LittleLab knowledge right now. Please try again.'
        );
        setCards([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  }, [query]);

  return { query, setQuery, cards, loading, error, empty };
}

