import React, { useMemo, useState } from 'react';
import { ChevronLeftIcon, XMarkIcon } from '@heroicons/react/24/outline';
import './assistant-shared.css';
import './assistant-results.css';

function pretty(v) {
  return String(v || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function AssistantResultsPage({
  snapshot,
  loading = false,
  onBack,
  onClose,
  onRefresh,
  onSaveEdit
}) {
  const [primaryConcern, setPrimaryConcern] = useState(snapshot?.primary_concern || '');
  const [routineConflicts, setRoutineConflicts] = useState(
    Array.isArray(snapshot?.routine_conflicts) ? snapshot.routine_conflicts.map((c) => c.summary || c.id || '').join(', ') : ''
  );
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const confidencePct = useMemo(
    () => Math.round(Math.max(0, Math.min(1, Number(snapshot?.confidence?.global || 0))) * 100),
    [snapshot]
  );

  const handleSave = async () => {
    if (!onSaveEdit) return;
    setSaving(true);
    try {
      if (primaryConcern && primaryConcern !== snapshot?.primary_concern) {
        await onSaveEdit({
          fieldPath: 'primary_concern',
          userValue: primaryConcern,
          reasonForChange: reason || 'user_corrected_primary_concern'
        });
      }
      const parsedConflicts = routineConflicts
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x, i) => ({
          id: `user_conflict_${i + 1}`,
          severity: 'medium',
          summary: x,
          recommendation: 'User-adjusted conflict item.'
        }));
      await onSaveEdit({
        fieldPath: 'routine_conflicts',
        userValue: parsedConflicts,
        reasonForChange: reason || 'user_corrected_routine_conflicts'
      });
      setReason('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="axr-root">
      <header className="axr-header">
        <button type="button" className="axr-icon-btn" onClick={onBack} aria-label="Back">
          <ChevronLeftIcon className="ax-heroicon" aria-hidden />
        </button>
        <div className="axr-title">Session Result Snapshot</div>
        <button type="button" className="axr-icon-btn" onClick={onClose} aria-label="Close">
          <XMarkIcon className="ax-heroicon" aria-hidden />
        </button>
      </header>

      <main className="axr-main">
        <section className="axr-card">
          <h3>Primary Concern</h3>
          <p className="axr-value">{pretty(snapshot?.primary_concern || 'unknown')}</p>
          <p className="axr-meta">Schema {snapshot?.schema_version || '1.0'} • Confidence {confidencePct}%</p>
        </section>

        <section className="axr-card">
          <h3>Routine Conflicts</h3>
          {Array.isArray(snapshot?.routine_conflicts) && snapshot.routine_conflicts.length ? (
            <ul className="axr-list">
              {snapshot.routine_conflicts.map((c, i) => (
                <li key={`${c.id || 'conflict'}-${i}`}>
                  <strong>{pretty(c?.severity || 'medium')}:</strong> {c?.summary || c?.id || 'Conflict'}
                </li>
              ))}
            </ul>
          ) : (
            <p className="axr-muted">No major routine conflicts were detected.</p>
          )}
        </section>

        {snapshot?.reasoning_map ? (
          <section className="axr-card">
            <h3>Why This Recommendation</h3>
            <p className="axr-meta">
              Confidence band: {pretty(snapshot?.reasoning_map?.confidence?.confidence_band || 'low')} •
              Evidence items: {Array.isArray(snapshot?.reasoning_map?.evidence_items) ? snapshot.reasoning_map.evidence_items.length : 0}
            </p>
            {Array.isArray(snapshot?.reasoning_map?.rules_fired) && snapshot.reasoning_map.rules_fired.length ? (
              <ul className="axr-list">
                {snapshot.reasoning_map.rules_fired.slice(0, 4).map((r, i) => (
                  <li key={`${r.rule_id || 'rule'}-${i}`}>
                    <strong>{pretty(r.rail || 'rule')}:</strong> {r.rationale || r.rule_id}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="axr-muted">No deterministic rules fired for this snapshot.</p>
            )}
          </section>
        ) : null}

        <section className="axr-card">
          <h3>Fix Results</h3>
          <label className="axr-label">
            Primary concern
            <input value={primaryConcern} onChange={(e) => setPrimaryConcern(e.target.value)} />
          </label>
          <label className="axr-label">
            Routine conflicts (comma-separated)
            <textarea value={routineConflicts} onChange={(e) => setRoutineConflicts(e.target.value)} rows={3} />
          </label>
          <label className="axr-label">
            Reason for change
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g., AI mixed irritation with acne" />
          </label>
          <div className="axr-actions">
            <button type="button" className="axr-btn" onClick={onRefresh} disabled={loading || saving}>
              Rescore
            </button>
            <button type="button" className="axr-btn axr-btn--primary" onClick={handleSave} disabled={loading || saving}>
              {saving ? 'Saving…' : 'Save corrections'}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
