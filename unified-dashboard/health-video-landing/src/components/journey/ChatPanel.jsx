import { isMemoryMessage } from '../../lib/sessionUtils.js';
import UrgencyLadder from './UrgencyLadder.jsx';
import TextOnlyBanner from './TextOnlyBanner.jsx';
import ChatEmptyState from './ChatEmptyState.jsx';
import TypingIndicator from './TypingIndicator.jsx';
import CameraConsentCard from './CameraConsentCard.jsx';
import CaptureConfirmCard from './CaptureConfirmCard.jsx';
import SuggestedReplies from './SuggestedReplies.jsx';
import SessionInputBar from './SessionInputBar.jsx';
import SessionAVControls from './SessionAVControls.jsx';
import MemoryCallout from './MemoryCallout.jsx';
import ToolCard from '../ToolCard.jsx';

export default function ChatPanel({
  patientMessageCount,
  riskVisible,
  urgencyLevel,
  compactUrgency,
  textOnly,
  messages,
  thinking,
  displayInitial,
  toolEvents,
  showKellyConsent,
  showCaptureConfirm,
  chatEndRef,
  lastKellyText,
  isLive,
  connected,
  inputText,
  onInputChange,
  onSend,
  onMicToggle,
  micOn,
  listening,
  camOn,
  onCameraToggle,
  onCameraAccept,
  onCameraDecline,
  onSelectReply,
  connStatus,
  error
}) {
  const hasGreeting = messages.some((m) => m.speaker === 'assistant');
  const showUrgency = riskVisible || Boolean(urgencyLevel);
  const showSuggested = isLive && !thinking && patientMessageCount > 0 && patientMessageCount < 6;

  return (
    <div className="hv-chat-panel">
      {showUrgency && (
        <UrgencyLadder
          riskVisible={riskVisible}
          urgencyLevel={urgencyLevel}
          compact={compactUrgency}
        />
      )}

      {textOnly && <TextOnlyBanner />}

      <div className="hv-chat-area" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && !thinking && !hasGreeting && (
          <ChatEmptyState onSelect={onSelectReply} />
        )}

        {messages.map((m) => (
          <div key={m.id} className={`hv-msg-row ${m.speaker === 'patient' ? 'me' : ''}`}>
            <div className={`hv-msg-av ${m.speaker === 'assistant' ? 'k' : 'u'}`}>
              {m.speaker === 'assistant' ? 'K' : displayInitial}
            </div>
            <div className="hv-msg-col">
              {m.speaker === 'assistant' && (
                <span className="hv-bubble-label">Kelly</span>
              )}
              {m.speaker === 'assistant' && isMemoryMessage(m.text) ? (
                <MemoryCallout>
                  <div className="hv-bubble k hv-bubble--memory">{m.text}</div>
                </MemoryCallout>
              ) : (
                <div className={`hv-bubble ${m.speaker === 'assistant' ? 'k' : 'u'}`}>
                  {m.text}
                </div>
              )}
            </div>
          </div>
        ))}

        {toolEvents.map((ev, i) => (
          <ToolCard key={`tool-${i}`} payload={ev} />
        ))}

        {thinking && (
          <div className="hv-msg-row">
            <div className="hv-msg-av k">K</div>
            <div className="hv-msg-col">
              <div className="hv-bubble k hv-bubble--thinking">
                <TypingIndicator />
              </div>
            </div>
          </div>
        )}

        {showSuggested && (
          <SuggestedReplies
            lastKellyText={lastKellyText}
            onSelect={onSelectReply}
            visible
          />
        )}

        {showKellyConsent && (
          <CameraConsentCard onAccept={onCameraAccept} onDecline={onCameraDecline} />
        )}

        <CaptureConfirmCard visible={showCaptureConfirm} />

        <div ref={chatEndRef} />
      </div>

      <SessionInputBar
        value={inputText}
        onChange={onInputChange}
        onSend={onSend}
        onMicToggle={onMicToggle}
        micOn={micOn && !textOnly}
        listening={listening}
        disabled={!connected}
      />

      <SessionAVControls camOn={camOn} onCameraToggle={onCameraToggle} />

      {connStatus === 'reconnecting' && (
        <p className="hv-reconnect-banner">Reconnecting to Kelly…</p>
      )}

      {error && <p className="hv-session-error">{error}</p>}

      <p className="hv-session-emergency">
        Not an emergency?{' '}
        <a href="tel:911">Call local emergency services</a> if urgent.
      </p>
    </div>
  );
}
