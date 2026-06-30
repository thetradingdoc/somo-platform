import {
  VideoCameraIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline';
import { VideoCameraIcon as VideoCameraIconSolid } from '@heroicons/react/24/solid';

export default function SessionControls({
  camOn,
  onCameraToggle,
  onEnd
}) {
  return (
    <div className="hv-sess-end-bar">
      <button
        type="button"
        className={`hv-fab-bar-btn ${camOn ? 'on' : ''}`}
        onClick={onCameraToggle}
        aria-pressed={camOn}
      >
        {camOn ? (
          <VideoCameraIconSolid className="hv-icon hv-icon--sm" aria-hidden="true" />
        ) : (
          <VideoCameraIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
        )}
        Camera
      </button>
      <button type="button" className="hv-fab-bar-btn primary" onClick={onEnd}>
        <DocumentTextIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
        Get my summary
      </button>
    </div>
  );
}
