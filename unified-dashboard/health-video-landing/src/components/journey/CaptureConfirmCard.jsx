import { CheckCircleIcon } from '@heroicons/react/24/outline';

export default function CaptureConfirmCard({ visible }) {
  if (!visible) return null;

  return (
    <div className="hv-capture-confirm" role="status" aria-live="polite">
      <CheckCircleIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
      <span>Kelly reviewed that</span>
    </div>
  );
}
