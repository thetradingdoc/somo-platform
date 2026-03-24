import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { Search } from './Search';
import { RoleSelect } from './RoleSelect';
import { SideNavPanel } from './SideNavPanel';
import { useRAGSearch } from './useRAGSearch';

function Root() {
  const { query, setQuery, cards, loading, error, empty } = useRAGSearch();
  const [selectedCard, setSelectedCard] = useState(null);
  const [flippedCardId, setFlippedCardId] = useState(null);
  const isTouchDevice = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches,
    []
  );
  const displayCards = cards.length > 0 ? cards : [];
  const selectedInResults = useMemo(() => {
    if (!selectedCard || !displayCards.length) return selectedCard;
    return (
      displayCards.find((c) => (c.id || c.code) === (selectedCard.id || selectedCard.code)) || selectedCard
    );
  }, [displayCards, selectedCard]);
  const selectedCardId = selectedInResults ? selectedInResults.id || selectedInResults.code : null;

  const handleCardSelect = (card) => {
    if (!card) {
      setSelectedCard(null);
      setFlippedCardId(null);
      return;
    }
    const clickedId = card.id || card.code;
    const currentId = selectedCard ? selectedCard.id || selectedCard.code : null;
    if (isTouchDevice && currentId === clickedId) {
      setFlippedCardId((prev) => (prev === clickedId ? null : clickedId));
      return;
    }
    const next = currentId === clickedId ? null : card;
    setSelectedCard(next);
    if (!next) setFlippedCardId(null);
  };

  const handleCardFlip = (card) => {
    if (!card) return;
    const cardId = card.id || card.code;
    setSelectedCard(card);
    setFlippedCardId((prev) => (prev === cardId ? null : cardId));
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectedCard(null);
        setFlippedCardId(null);
        return;
      }
      if (!displayCards.length) return;
      const selectedId = selectedInResults ? (selectedInResults.id || selectedInResults.code) : null;
      const selectedIdx = selectedId == null ? -1 : displayCards.findIndex((c) => (c.id || c.code) === selectedId);
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const dir = event.key === 'ArrowRight' ? 1 : -1;
        const base = selectedIdx >= 0 ? selectedIdx : 0;
        const nextIdx = (base + dir + displayCards.length) % displayCards.length;
        handleCardSelect(displayCards[nextIdx]);
        return;
      }
      if (!selectedInResults) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleCardFlip(selectedInResults);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedInResults, displayCards]);

  // Keep selection in sync with current search state/results
  useEffect(() => {
    if (loading || error || empty) {
      setSelectedCard(null);
      setFlippedCardId(null);
      return;
    }
    if (!selectedCard || !cards.length) return;
    const selectedId = selectedCard.id || selectedCard.code;
    const stillExists = cards.some((c) => (c.id || c.code) === selectedId);
    if (!stillExists) {
      setSelectedCard(null);
      setFlippedCardId(null);
    }
  }, [loading, error, empty, cards, selectedCard]);

  return (
    <>
      <App
        cards={cards}
        selectedCardId={selectedCardId}
        flippedCardId={flippedCardId}
        onCardSelect={handleCardSelect}
        onCardFlip={handleCardFlip}
      />
      <SideNavPanel />
      <div className="ui-layer">
        <header className="brand">
          <h1 className="logo-wordmark" aria-label="littlelab">
            <span className="logo-little">little</span>
            <span className="logo-lab-wrap">
              <span className="logo-lab">lab</span>
              <span className="logo-dot">.</span>
            </span>
          </h1>
          <p className="brand-tagline">An AI Research Lab</p>
          <p className="brand-mission">
            We explore how machine learning can make healthcare more accessible, transparent, and human.
            Search our medical ontology or enter as a patient or provider.
          </p>
        </header>
        <Search
          query={query}
          setQuery={setQuery}
          loading={loading}
          error={error}
          empty={empty}
        />
        <RoleSelect query={query} variant="soft" />
      </div>
      {selectedInResults && (
        <aside className="card-detail-panel" aria-live="polite" aria-label="Selected medical ontology card details">
          <button
            className="card-detail-close"
            onClick={() => {
              setSelectedCard(null);
              setFlippedCardId(null);
            }}
            aria-label="Close card details"
          >
            ×
          </button>
          <p className="card-detail-category">{selectedInResults.category || 'Medical concept'}</p>
          <p className="card-detail-category">{selectedInResults.codingSystem || 'Ontology'}</p>
          <h2 className="card-detail-code">{selectedInResults.code || '—'}</h2>
          <p className="card-detail-label">{selectedInResults.label || 'No description available.'}</p>
          <p className="card-detail-label">{selectedInResults.summary || 'Summary unavailable for this concept.'}</p>
          <p className="card-detail-confidence">Next: {selectedInResults.nextStep || 'Review this with a clinician.'}</p>
          {!!(selectedInResults.related && selectedInResults.related.length) && (
            <p className="card-detail-confidence">Related: {selectedInResults.related.join(' • ')}</p>
          )}
          {Number.isFinite(Number(selectedInResults.relevance)) && (
            <>
              <p className="card-detail-confidence">
                Relevance: {Math.round(Number(selectedInResults.relevance) * 100)}%
              </p>
              <div className="relevance-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(Number(selectedInResults.relevance) * 100)}%` }} />
              </div>
            </>
          )}
        </aside>
      )}
      {selectedInResults && (
        <div className="card-keyboard-aid" role="note" aria-live="polite">
          Press Enter or Space to flip selected card. Press Esc to close.
        </div>
      )}
      {!!displayCards.length && (
        <div className="sr-only-card-nav" role="list" aria-label="Card keyboard navigation">
          {displayCards.map((card) => {
            const id = card.id || card.code;
            return (
              <button
                key={id}
                className="sr-only-nav-btn"
                onFocus={() => handleCardSelect(card)}
                onClick={() => handleCardFlip(card)}
                aria-label={`Select ${card.label || card.code}`}
              >
                {card.label || card.code}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

const container = document.getElementById('root');
createRoot(container).render(<Root />);

