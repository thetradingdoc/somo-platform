import { PencilSquareIcon, MicrophoneIcon } from '@heroicons/react/24/outline';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import BtnPrimary from '../brand/BtnPrimary.jsx';
import BtnSecondary from '../brand/BtnSecondary.jsx';

export default function PermissionDeniedSheet({ open, onTextOnly, onRetryMic }) {
  const trapRef = useFocusTrap(open);

  if (!open) return null;

  return (
    <div className="hv-sheet-backdrop hv-perm-denied-backdrop" role="presentation">
      <div
        ref={trapRef}
        className="hv-sheet hv-perm-denied-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="perm-denied-title"
      >
        <div className="hv-sheet-handle" />
        <h3 id="perm-denied-title" className="hv-sheet-title">Microphone access needed</h3>
        <p className="hv-sheet-sub">
          Kelly works best with voice, but you can continue by typing if you prefer.
        </p>
        <BtnPrimary onClick={onRetryMic}>
          <MicrophoneIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
          {' '}Allow microphone
        </BtnPrimary>
        <BtnSecondary onClick={onTextOnly}>
          <PencilSquareIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
          {' '}Continue with text only
        </BtnSecondary>
      </div>
    </div>
  );
}
