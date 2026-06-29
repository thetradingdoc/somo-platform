import { VideoCameraIcon } from '@heroicons/react/24/outline';

export default function CameraConsentCard({ onAccept, onDecline }) {
  return (
    <div className="hv-camera-consent" role="region" aria-label="Camera consent">
      <div className="hv-camera-consent-label">
        <VideoCameraIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
        Camera request from Somo
      </div>
      <p>
        Show the affected area for a few seconds. The image is only used in this session and is not saved or stored.
        You can also keep describing in words.
      </p>
      <div className="hv-camera-consent-actions">
        <button type="button" className="hv-camera-yes" onClick={onAccept}>
          Yes, show Somo
        </button>
        <button type="button" className="hv-camera-no" onClick={onDecline}>
          No, keep describing
        </button>
      </div>
    </div>
  );
}
