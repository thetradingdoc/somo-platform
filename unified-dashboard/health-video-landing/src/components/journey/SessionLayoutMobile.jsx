import RiskBanner from '../RiskBanner.jsx';
import KellyStage from './KellyStage.jsx';
import ChatPanel from './ChatPanel.jsx';

export default function SessionLayoutMobile(props) {
  const {
    riskVisible,
    presenceLive,
    videoRef,
    camOn,
    bodyGuidance,
    onOverlayDismiss,
    ...chatProps
  } = props;

  return (
    <div className={`hv-session-shell hv-session-shell--mobile hv-fade-in ${camOn ? 'hv-session-shell--camera-active' : ''}`}>
      <RiskBanner visible={riskVisible} />

      <KellyStage
        status={presenceLive.status}
        avatarState={presenceLive.avatarState}
        videoRef={videoRef}
        camOn={camOn}
        bodyGuidance={bodyGuidance}
        onOverlayDismiss={onOverlayDismiss}
      />

      <ChatPanel
        {...chatProps}
        compactUrgency
        camOn={camOn}
      />
    </div>
  );
}
