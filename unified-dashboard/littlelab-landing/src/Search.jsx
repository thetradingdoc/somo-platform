import React, { useEffect, useRef } from 'react';

export function Search({ query, setQuery, loading, error, empty }) {
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="search-wrapper" aria-label="Consult medical search">
      <div className="search-box" role="search">
        <svg
          className="search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          aria-label="Search symptoms, conditions, procedures"
          placeholder="Explore medical concepts, symptoms, procedures…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {loading && <span className="search-spinner" />}
        {query && !loading && (
          <button className="search-clear" onClick={() => setQuery('')}>
            ✕
          </button>
        )}
      </div>
      {query && query.trim().length > 1 && !error && !empty && (
        <p className="search-hint">
          {loading ? 'Searching knowledge base…' : 'Click a card to inspect details'}
        </p>
      )}
      {error && (
        <p className="search-hint" style={{ color: '#b91c1c' }}>
          {error}
        </p>
      )}
      {!error && !loading && query && query.trim().length > 1 && empty && (
        <p className="search-hint">No close matches yet. Try a different phrase.</p>
      )}
    </div>
  );
}

