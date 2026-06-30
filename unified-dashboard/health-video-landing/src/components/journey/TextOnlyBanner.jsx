import { PencilSquareIcon } from '@heroicons/react/24/outline';

export default function TextOnlyBanner() {
  return (
    <div className="hv-text-only-banner" role="status">
      <PencilSquareIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
      <span>Voice unavailable — type your messages below</span>
    </div>
  );
}
