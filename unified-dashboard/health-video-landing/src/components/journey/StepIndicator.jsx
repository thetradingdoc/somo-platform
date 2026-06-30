export default function StepIndicator({ step }) {
  return (
    <div className="hv-step-indicator" aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className={`hv-step-dot ${n < step ? 'done' : ''} ${n === step ? 'active' : ''}`}
        />
      ))}
    </div>
  );
}
