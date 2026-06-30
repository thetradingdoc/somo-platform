const LEVELS = [
  { id: 'routine', label: 'Routine', desc: 'Self-care may be appropriate' },
  { id: 'follow-up', label: 'Follow-up', desc: 'Consider seeing a clinician' },
  { id: 'seek-care', label: 'Seek care', desc: 'Get in-person care soon' }
];

function resolveActive(riskVisible, urgencyLevel) {
  if (riskVisible || urgencyLevel === 'emergency') return 'seek-care';
  if (urgencyLevel === 'urgent' || urgencyLevel === 'urgency') return 'follow-up';
  return 'routine';
}

export default function UrgencyLadder({ riskVisible, urgencyLevel, compact = false }) {
  if (!riskVisible && !urgencyLevel) return null;

  const active = resolveActive(riskVisible, urgencyLevel);
  const activeLevel = LEVELS.find((l) => l.id === active) || LEVELS[0];

  if (compact) {
    return (
      <div className={`hv-urgency-chip hv-urgency-chip--${active}`} aria-label="Care urgency">
        <span className="hv-urgency-chip-label">{activeLevel.label}</span>
        <span className="hv-urgency-chip-desc">{activeLevel.desc}</span>
      </div>
    );
  }

  const activeIdx = LEVELS.findIndex((l) => l.id === active);

  return (
    <div className="hv-urgency-ladder" aria-label="Care urgency">
      {LEVELS.map((level, i) => (
        <div
          key={level.id}
          className={`hv-urgency-step ${level.id} ${i <= activeIdx ? 'lit' : ''} ${i === activeIdx ? 'active' : ''}`}
        >
          <span className="hv-urgency-step-label">{level.label}</span>
          {i === activeIdx && <span className="hv-urgency-step-desc">{level.desc}</span>}
        </div>
      ))}
    </div>
  );
}
