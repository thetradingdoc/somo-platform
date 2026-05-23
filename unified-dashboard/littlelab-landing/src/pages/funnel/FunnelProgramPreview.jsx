import React, { useState } from 'react';
import { concernChipLabel } from './funnelConcernLabels';

export default function FunnelProgramPreview({
  preview,
  displayAge,
  concernId,
  matchResult,
  secondaryConcernIds,
  onSave,
  onBack,
}) {
  const [expanded, setExpanded] = useState(false);
  const weekOne = preview?.week_one || {};
  const redFlags = Array.isArray(preview?.red_flags) ? preview.red_flags : [];
  const planLabel = preview?.week_one?.label || preview?.label || concernChipLabel(concernId);
  const lowConfidence =
    matchResult?.confidence != null && Number(matchResult.confidence) < 0.7 && matchResult?.route === 'program';
  const isAntiAging = concernId === 'anti_aging';
  const secondaries =
    secondaryConcernIds?.length > 0
      ? secondaryConcernIds
      : matchResult?.secondary_concern_ids || [];
  const secondaryLine =
    secondaries.length > 0
      ? `You also noted: ${secondaries.map((id) => concernChipLabel(id)).filter(Boolean).join(', ')} — we'll focus on ${planLabel} first.`
      : null;

  return (
    <div className="funnel-card funnel-card--age">
      {displayAge != null ? (
        <p className="funnel-meta-pill">Photo · {Math.round(Number(displayAge))}</p>
      ) : null}
      {matchResult?.face_read_note ? (
        <p className="funnel-confidence-pill">{matchResult.face_read_note}</p>
      ) : null}
      {lowConfidence ? (
        <p className="funnel-confidence-pill funnel-confidence-pill--low">
          We matched this program from your description — a dermatologist can confirm if unsure.
        </p>
      ) : null}
      {isAntiAging ? (
        <p className="funnel-confidence-pill">
          One progress photo logs your day — track texture and fine lines over weeks, not just today.
        </p>
      ) : (
        <p className="funnel-confidence-pill">
          One progress photo = day logged. Your plan updates as you track each week.
        </p>
      )}
      {matchResult?.scores?.length ? (
        <p className="funnel-match-rationale" role="status">
          Matched from: {matchResult.scores.map((s) => concernChipLabel(s.concern_id)).filter(Boolean).join(', ')}
        </p>
      ) : null}
      {secondaryLine ? (
        <p className="funnel-photo-honest" role="status">
          {secondaryLine}
        </p>
      ) : null}

      <div className="funnel-preview-card">
        {weekOne.expect ? (
          <section className="funnel-preview-section">
            <p className="funnel-preview-kicker">This week</p>
            <p className="funnel-preview-body">{weekOne.expect}</p>
          </section>
        ) : null}
        {redFlags.length > 0 ? (
          <section className="funnel-preview-section">
            <p className="funnel-preview-kicker">Watch for</p>
            <ul className="funnel-preview-watch-list">
              {redFlags.map((flag, i) => (
                <li key={i} className="funnel-preview-body funnel-preview-watch">
                  {flag}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="funnel-preview-section">
          <p className="funnel-preview-kicker">Your plan</p>
          <p className="funnel-preview-body">
            {planLabel}
            {preview?.total_weeks ? ` · ${preview.total_weeks} weeks` : ''}
          </p>
        </section>
      </div>

      {expanded ? (
        <details className="funnel-preview-routine-expand" open>
          <summary>AM / PM steps</summary>
          {weekOne.am_steps?.length ? (
            <>
              <p className="funnel-preview-kicker">Morning</p>
              <ol className="funnel-preview-steps">
                {weekOne.am_steps.map((s, i) => (
                  <li key={`am-${i}`}>{s}</li>
                ))}
              </ol>
            </>
          ) : null}
          {weekOne.pm_steps?.length ? (
            <>
              <p className="funnel-preview-kicker">Evening</p>
              <ol className="funnel-preview-steps">
                {weekOne.pm_steps.map((s, i) => (
                  <li key={`pm-${i}`}>{s}</li>
                ))}
              </ol>
            </>
          ) : null}
        </details>
      ) : null}

      <div className="funnel-card-actions funnel-card-actions--stacked">
        <button type="button" className="funnel-btn" onClick={onSave}>
          Save my program
        </button>
        <button
          type="button"
          className="funnel-btn funnel-btn-secondary"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide routine' : 'See full routine'}
        </button>
        {onBack ? (
          <button type="button" className="funnel-btn-ghost" onClick={onBack}>
            Change concern
          </button>
        ) : null}
      </div>
      <p className="funnel-card-disc">
        Wellness guidance only — not medical advice. See a dermatologist for diagnosis or treatment.
      </p>
    </div>
  );
}
