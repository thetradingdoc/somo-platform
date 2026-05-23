import React, { useState } from 'react';
import { getClarifyAnswers, setClarifyAnswers } from '../../lib/funnelSession';

export default function FunnelClarifyQuestions({ questions, onSubmit, onBack, loading }) {
  const [answers, setAnswers] = useState(() => getClarifyAnswers() || {});

  function setAnswer(id, value) {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    setClarifyAnswers(next);
  }

  const list = Array.isArray(questions) ? questions : [];
  const complete = list.every((q) => answers[q.id]);

  return (
    <div className="funnel-card funnel-card--age funnel-clarify">
      {list.map((q) => (
        <fieldset key={q.id} className="funnel-clarify-fieldset">
          <legend className="funnel-age-field-label">{q.prompt}</legend>
          <div className="funnel-clarify-options">
            {(q.options || []).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`funnel-chip${answers[q.id] === opt.id ? ' funnel-chip--active' : ''}`}
                onClick={() => setAnswer(q.id, opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="funnel-card-actions funnel-card-actions--stacked">
        <button
          type="button"
          className="funnel-btn"
          disabled={!complete || loading}
          onClick={() => onSubmit?.(answers)}
        >
          {loading ? 'Updating…' : 'Continue'}
        </button>
        <button type="button" className="funnel-btn funnel-btn-secondary" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
