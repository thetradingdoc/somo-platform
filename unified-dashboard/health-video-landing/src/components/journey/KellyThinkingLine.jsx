export default function KellyThinkingLine({ line }) {
  return (
    <span className="hv-thinking-line" aria-live="polite">
      {line || 'Somo is thinking…'}
    </span>
  );
}
