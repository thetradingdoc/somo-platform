import { XMarkIcon } from '@heroicons/react/24/outline';

export default function BodyRegionOverlay({ guidance, visible, onDismiss, scoped = false }) {
  if (!visible || !guidance) return null;
  return (
    <div className={`hv-body-overlay ${scoped ? 'hv-body-overlay--scoped' : ''}`} aria-live="polite">
      <button
        type="button"
        className="hv-body-overlay-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss camera guidance"
      >
        <XMarkIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
      </button>
      <div className="hv-body-oval" />
      <p className="hv-body-hint">{guidance}</p>
    </div>
  );
}
