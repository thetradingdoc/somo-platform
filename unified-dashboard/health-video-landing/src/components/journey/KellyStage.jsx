import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import KellyAvatar from './KellyAvatar.jsx';
import KellyChip from './KellyChip.jsx';
import SelfPip from './SelfPip.jsx';
import BodyRegionOverlay from '../BodyRegionOverlay.jsx';

export default function KellyStage({
  status,
  avatarState = 'idle',
  videoRef,
  camOn,
  bodyGuidance,
  onOverlayDismiss
}) {
  return (
    <div
      className={`hv-kelly-stage ${camOn ? 'hv-kelly-stage--camera-active' : 'hv-kelly-stage--compact'}`}
      data-testid="kelly-stage"
    >
      <div className="hv-safe-badge hv-safe-badge--stage">
        <ShieldCheckIcon className="hv-icon hv-icon--xs" aria-hidden="true" />
        Encrypted
      </div>

      {camOn ? (
        <>
          <SelfPip videoRef={videoRef} camOn={camOn} variant="stage-full" />
          <KellyChip status={status} avatarState={avatarState} />
        </>
      ) : (
        <div className={`hv-kelly-stage-compact hv-kelly-stage-compact--${avatarState}`}>
          <KellyAvatar size="sm" />
          <div className="hv-kelly-stage-compact-text">
            <span className="hv-kelly-stage-compact-name">Kelly · AI health assistant</span>
            <span className="hv-kelly-stage-compact-status">{status}</span>
          </div>
        </div>
      )}

      {camOn && bodyGuidance && (
        <BodyRegionOverlay
          guidance={bodyGuidance}
          visible
          onDismiss={onOverlayDismiss}
          scoped
        />
      )}
    </div>
  );
}
