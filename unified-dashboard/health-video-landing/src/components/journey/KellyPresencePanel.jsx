import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import KellyAvatar from './KellyAvatar.jsx';
import KellyChip from './KellyChip.jsx';
import SelfPip from './SelfPip.jsx';
import BodyRegionOverlay from '../BodyRegionOverlay.jsx';

function SoundBars() {
  return (
    <div className="hv-sound-bars" aria-hidden="true">
      <span className="hv-sound-bar" />
      <span className="hv-sound-bar" />
      <span className="hv-sound-bar" />
      <span className="hv-sound-bar" />
      <span className="hv-sound-bar" />
    </div>
  );
}

export default function KellyPresencePanel({
  status,
  avatarState = 'idle',
  listening,
  videoRef,
  camOn,
  bodyGuidance,
  onOverlayDismiss
}) {
  const showSpeaking = avatarState === 'listening' && listening;

  return (
    <div
      className={`hv-kelly-presence-panel ${camOn ? 'hv-kelly-presence-panel--camera-active' : 'hv-kelly-presence-panel--compact'}`}
      data-testid="kelly-presence-panel"
    >
      {camOn ? (
        <>
          <SelfPip videoRef={videoRef} camOn={camOn} variant="desktop-full" />
          <div className="hv-safe-badge hv-safe-badge--presence">
            <ShieldCheckIcon className="hv-icon hv-icon--xs" aria-hidden="true" />
            Encrypted
          </div>
          <KellyChip status={status} avatarState={avatarState} />
        </>
      ) : (
        <div className={`hv-kelly-presence-compact hv-kelly-presence-inner--${avatarState}`}>
          <KellyAvatar size="md" />
          <div className="hv-kelly-presence-compact-text">
            <span className="hv-kelly-name-tag">Kelly · AI health assistant</span>
            {showSpeaking ? (
              <span className="hv-kelly-speaking-label hv-kelly-speaking-label--compact">
                <SoundBars />
                Kelly is listening
              </span>
            ) : (
              <span className="hv-kelly-presence-status">{status}</span>
            )}
          </div>
          <div className="hv-safe-badge hv-safe-badge--presence hv-safe-badge--compact">
            <ShieldCheckIcon className="hv-icon hv-icon--xs" aria-hidden="true" />
            Encrypted
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
