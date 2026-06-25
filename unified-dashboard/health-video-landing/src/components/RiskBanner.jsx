import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export default function RiskBanner({ visible }) {
  if (!visible) return null;
  return (
    <div className="hv-risk-banner" role="alert">
      <ExclamationTriangleIcon className="hv-icon hv-icon--md" aria-hidden="true" />
      <div>
        <strong>Possible urgent symptoms detected.</strong>
        {' '}If this is a medical emergency, call your local emergency number now (e.g. 911).
        This chat is not emergency care.
      </div>
    </div>
  );
}
