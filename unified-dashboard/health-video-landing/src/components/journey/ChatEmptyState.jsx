const TOPICS = [
  { label: 'Pain', opener: 'I have pain that started recently.' },
  { label: 'Cold / flu', opener: 'I think I might have a cold or flu.' },
  { label: 'Skin concern', opener: 'I have a skin concern I want to discuss.' },
  { label: 'Digestive', opener: 'I have digestive symptoms.' },
  { label: 'Medications', opener: 'I have a question about my medications.' }
];

export default function ChatEmptyState({ onSelect }) {
  return (
    <div className="hv-chat-empty-state">
      <p className="hv-chat-empty-title">What can Somo help with today?</p>
      <div className="hv-topic-chips" role="group" aria-label="Common topics">
        {TOPICS.map((t) => (
          <button
            key={t.label}
            type="button"
            className="hv-topic-chip"
            onClick={() => onSelect?.(t.opener)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
