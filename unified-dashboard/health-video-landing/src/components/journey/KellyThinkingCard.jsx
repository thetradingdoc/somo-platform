const CHECKLIST = [
  'Evaluating duration and pattern',
  'Considering severity',
  'Checking related symptoms'
];

export default function KellyThinkingCard() {
  return (
    <div className="hv-thinking-card" aria-live="polite">
      <div className="hv-thinking-card-title">Somo is reviewing</div>
      <ul className="hv-thinking-checklist">
        {CHECKLIST.map((item) => (
          <li key={item}>
            <span className="hv-thinking-check" aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
