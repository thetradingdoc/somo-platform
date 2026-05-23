import React, { useEffect, useState } from 'react';
import { fetchRoutineConcerns } from '../../lib/funnelApi';
import { CONCERN_CHIP_LABELS, concernChipLabel } from './funnelConcernLabels';

const CHIP_ORDER = ['acne', 'anti_aging', 'hyperpigmentation', 'rosacea', 'barrier_repair'];

export default function FunnelConcernPicker({
  selectedIds = [],
  onToggle,
  onNotSure,
  disabled = false,
}) {
  const [concerns, setConcerns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds : []);

  useEffect(() => {
    let cancelled = false;
    fetchRoutineConcerns()
      .then((rows) => {
        if (cancelled) return;
        const ordered = CHIP_ORDER.map((id) => rows.find((c) => c.id === id)).filter(Boolean);
        setConcerns(ordered.length ? ordered : rows);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || 'Could not load options');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="funnel-analyzing-text">Loading care plans…</p>;
  }

  if (error) {
    return (
      <>
        <p className="funnel-error">{error}</p>
        <button type="button" className="funnel-btn" onClick={() => onNotSure?.()}>
          Try again
        </button>
      </>
    );
  }

  return (
    <div className="funnel-card funnel-card--age">
      <div
        className="funnel-concern-grid"
        role="listbox"
        aria-label="Skin concerns"
        aria-multiselectable="true"
      >
        {concerns.map((c) => {
          const label = CONCERN_CHIP_LABELS[c.id] || concernChipLabel(c.id);
          const selected = selectedSet.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={`funnel-concern-chip${selected ? ' funnel-concern-chip--selected' : ''}`}
              disabled={disabled}
              onClick={() => onToggle?.(c.id)}
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          className="funnel-concern-chip funnel-concern-chip--not-sure"
          disabled={disabled}
          onClick={() => onNotSure?.()}
        >
          Not sure
        </button>
      </div>
    </div>
  );
}
