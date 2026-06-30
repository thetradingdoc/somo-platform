export default function SessionProgressStrip({ stages }) {
  if (!stages?.length) return null;

  return (
    <div className="hv-progress-strip" aria-label="Session progress">
      {stages.map((s) => (
        <div
          key={s.id}
          className={`hv-progress-step ${s.done ? 'done' : ''} ${s.active ? 'active' : ''}`}
        >
          <span className="hv-progress-dot" aria-hidden="true" />
          <span className="hv-progress-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
