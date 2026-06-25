import { useFocusTrap } from '../../lib/useFocusTrap.js';
import BtnPrimary from '../brand/BtnPrimary.jsx';
import BtnSecondary from '../brand/BtnSecondary.jsx';

const BULLETS = [
  'Only you decide when the camera turns on',
  'Kelly reviews frames to help — not for storage',
  'You can turn the camera off anytime',
  'Nothing is shared without your consent'
];

export default function CameraEducationSheet({ open, onContinue, onCancel }) {
  const trapRef = useFocusTrap(open, onCancel);

  if (!open) return null;

  return (
    <div className="hv-sheet-backdrop" role="presentation">
      <div
        ref={trapRef}
        className="hv-sheet hv-camera-education"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-ed-title"
      >
        <div className="hv-sheet-handle" />
        <h3 id="camera-ed-title" className="hv-sheet-title">Before you turn on camera</h3>
        <ul className="hv-camera-ed-list">
          {BULLETS.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <BtnPrimary onClick={onContinue}>Continue with camera</BtnPrimary>
        <BtnSecondary onClick={onCancel}>Not now</BtnSecondary>
      </div>
    </div>
  );
}
