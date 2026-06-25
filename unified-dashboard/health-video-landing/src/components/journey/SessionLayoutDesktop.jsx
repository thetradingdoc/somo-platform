import RiskBanner from '../RiskBanner.jsx';
import KellyPresencePanel from './KellyPresencePanel.jsx';
import ChatPanel from './ChatPanel.jsx';

export default function SessionLayoutDesktop(props) {
  const {
    riskVisible,
    presenceLive,
    listening,
    videoRef,
    camOn,
    bodyGuidance,
    onOverlayDismiss,
    ...chatProps
  } = props;

  return (
    <div className="hv-session-shell hv-session-shell--desktop hv-fade-in">
      <RiskBanner visible={riskVisible} />

      <div className="hv-session-desktop-grid">
        <KellyPresencePanel
          status={presenceLive.status}
          avatarState={presenceLive.avatarState}
          listening={listening}
          videoRef={videoRef}
          camOn={camOn}
          bodyGuidance={bodyGuidance}
          onOverlayDismiss={onOverlayDismiss}
        />

        <ChatPanel
          {...chatProps}
          compactUrgency={false}
          camOn={camOn}
        />
      </div>
    </div>
  );
}
