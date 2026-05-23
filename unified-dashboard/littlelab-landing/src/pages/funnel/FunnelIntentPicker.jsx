import React from 'react';
import { clearZip, getUserGoal, setSpecialistUpsell, setUserGoal } from '../../lib/funnelSession';

const INTENTS = [
  {
    id: 'track_program',
    title: 'Track a routine',
    body: 'Get a guided week-1 plan and log progress with photos.',
  },
  {
    id: 'find_specialist',
    title: 'Find a specialist',
    body: 'Browse specialists near you — no program required. US ZIP search only (NPPES physician directory).',
  },
];

function initialIntentSelection() {
  const g = getUserGoal();
  return g === 'find_specialist' ? 'find_specialist' : 'track_program';
}

export default function FunnelIntentPicker({ onContinue, onBack }) {
  const [selected, setSelected] = React.useState(initialIntentSelection);

  function pick(id) {
    setSelected(id);
    setSpecialistUpsell(false);
    setUserGoal(id);
    if (id === 'track_program') clearZip();
  }

  return (
    <div className="funnel-card funnel-card--age funnel-intent-picker">
      <p className="funnel-preview-body funnel-intent-lead">
        How can we help today?
      </p>
      <ul className="funnel-intent-list" role="listbox" aria-label="Your goal">
        {INTENTS.map((item) => {
          const active = selected === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                className={`funnel-intent-card${active ? ' funnel-intent-card--active' : ''}`}
                onClick={() => pick(item.id)}
              >
                <span className="funnel-intent-card-title">{item.title}</span>
                <span className="funnel-intent-card-body">{item.body}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div
        className={`funnel-card-actions${onBack ? ' funnel-card-actions--stacked' : ''}`}
      >
        <button type="button" className="funnel-btn" onClick={() => onContinue?.(selected)}>
          Continue
        </button>
        {onBack ? (
          <button type="button" className="funnel-btn funnel-btn-secondary" onClick={onBack}>
            Back
          </button>
        ) : null}
      </div>
    </div>
  );
}
