import {
  VideoCameraIcon
} from '@heroicons/react/24/outline';
import { VideoCameraIcon as VideoCameraIconSolid } from '@heroicons/react/24/solid';

export default function SessionAVControls({ camOn, onCameraToggle }) {
  return (
    <div className="hv-sess-av-bar">
      <button
        type="button"
        className={`hv-sess-camera-btn ${camOn ? 'on' : ''}`}
        onClick={onCameraToggle}
        aria-pressed={camOn}
      >
        {camOn ? (
          <VideoCameraIconSolid className="hv-icon hv-icon--sm" aria-hidden="true" />
        ) : (
          <VideoCameraIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
        )}
        {camOn ? 'Camera on' : 'Turn on camera'}
      </button>
    </div>
  );
}
