import { MicrophoneIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import BtnPrimary from '../brand/BtnPrimary.jsx';
import JourneyShell from './JourneyShell.jsx';

export default function PermissionDeniedView({ onTextOnly, onRetryMic }) {
  return (
    <JourneyShell>
      <div className="hv-perm-screen">
        <div className="hv-perm-icon-well" aria-hidden="true">
          <MicrophoneIcon className="hv-icon hv-icon--lg" />
        </div>
        <h2 className="hv-perm-title">Microphone access needed</h2>
        <p className="hv-perm-sub">
          Somo works best when it can hear you — but you can also type your messages if you prefer.
        </p>
        <button type="button" className="hv-perm-option recommended" onClick={onRetryMic}>
          <span className="hv-perm-opt-icon" aria-hidden="true">
            <MicrophoneIcon className="hv-icon hv-icon--md" />
          </span>
          <div>
            <div className="hv-perm-opt-title">Allow microphone</div>
            <div className="hv-perm-opt-sub">Recommended — talk naturally to Somo</div>
          </div>
        </button>
        <button type="button" className="hv-perm-option" onClick={onTextOnly}>
          <span className="hv-perm-opt-icon" aria-hidden="true">
            <PencilSquareIcon className="hv-icon hv-icon--md" />
          </span>
          <div>
            <div className="hv-perm-opt-title">Type instead</div>
            <div className="hv-perm-opt-sub">Continue without microphone — use the text box</div>
          </div>
        </button>
        <BtnPrimary style={{ marginTop: 16 }} onClick={onTextOnly}>
          Continue typing only
        </BtnPrimary>
      </div>
    </JourneyShell>
  );
}
