const STATIC_CHIPS = ['About a week', 'It hurts a lot', 'Yes', 'No', 'Not sure'];

function deriveChips(lastKellyText) {
  const t = String(lastKellyText || '').toLowerCase();
  const chips = [];

  if (t.includes('how long') || t.includes('when did') || t.includes('duration')) {
    chips.push('A few days', 'About a week', 'More than a month');
  }
  if (t.includes('scale') || t.includes('severe') || t.includes('1 to 10') || t.includes('1-10')) {
    chips.push('Mild', 'Moderate', 'Severe');
  }
  if (t.includes('?') && (t.includes('any') || t.includes('have you') || t.includes('do you'))) {
    chips.push('Yes', 'No', 'Not sure');
  }

  if (chips.length === 0) return STATIC_CHIPS.slice(0, 3);
  return [...new Set(chips)].slice(0, 3);
}

export default function SuggestedReplies({ lastKellyText, onSelect, visible }) {
  if (!visible) return null;

  const chips = deriveChips(lastKellyText);

  return (
    <div className="hv-suggested-replies" role="group" aria-label="Suggested replies">
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          className="hv-suggested-chip"
          onClick={() => onSelect?.(chip)}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}
