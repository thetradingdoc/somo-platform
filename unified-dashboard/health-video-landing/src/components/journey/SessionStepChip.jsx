export default function SessionStepChip({ stages }) {
  if (!stages?.length) return null;
  const active = stages.find((s) => s.active) || stages[0];
  if (!active?.label) return null;

  return (
    <div className="hv-session-step-chip" aria-label="Session progress">
      <span className="hv-session-step-chip-dot" aria-hidden="true" />
      <span className="hv-session-step-chip-label">{active.label}</span>
    </div>
  );
}
