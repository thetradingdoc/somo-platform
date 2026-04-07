import React, { useMemo } from 'react';
import { CameraIcon, ChatBubbleLeftRightIcon, ChevronLeftIcon, MicrophoneIcon } from '@heroicons/react/24/outline';
import AgentSphereCanvas from './AgentSphereCanvas';
import LiveKitPanel from './LiveKitPanel';
import { segmentCaptionWithKeywordEmphasis } from './captionEmphasis';
import './assistant-shared.css';
import './assistant-voice.css';
import './assistant-livekit.css';

function CaptionLine({ segments }) {
  return (
    <p className="axv-live-caption axv-live-caption--scan" aria-live="polite">
      {segments.map((seg, i) =>
        seg.type === 'bold' ? (
          <strong key={i} className="axv-caption-strong">
            {seg.value}
          </strong>
        ) : (
          <span key={i}>{seg.value}</span>
        )
      )}
    </p>
  );
}

export default function AssistantVoicePage({
  onClose,
  onOpenChat,
  apiBase,
  messages,
  interimCaption,
  voiceActive,
  sending,
  toggleVoice,
  prefersReducedMotion,
  cameraRef,
  speechLevelRef,
  spherePaused,
  liveKit,
  localVideoRef,
  remoteVideoContainerRef
}) {
  const lastAssistantText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].text;
    }
    return '';
  }, [messages]);

  const captionSegments = useMemo(() => {
    if (interimCaption) return segmentCaptionWithKeywordEmphasis(interimCaption);
    if (voiceActive && !interimCaption) {
      return segmentCaptionWithKeywordEmphasis('Listening…');
    }
    if (lastAssistantText) {
      const t = lastAssistantText.length > 200 ? `${lastAssistantText.slice(0, 197)}…` : lastAssistantText;
      return segmentCaptionWithKeywordEmphasis(t);
    }
    return segmentCaptionWithKeywordEmphasis('Tap the mic to speak — or open chat to type.');
  }, [interimCaption, voiceActive, lastAssistantText]);

  const showLead = !interimCaption && !voiceActive && !lastAssistantText;
  const inSession = liveKit?.inSession;

  return (
    <div className={`axv-root ${inSession ? 'axv-root--session' : ''}`}>
      <header className={`axv-header ${inSession ? 'axv-header--floating' : ''}`}>
        <button type="button" className="axv-icon-btn" onClick={onClose} aria-label="Back to landing">
          <ChevronLeftIcon className="ax-heroicon" aria-hidden />
        </button>
        <div className="axv-pill">
          <img
            className="axv-pill-logo"
            src="/images/branding/logo-panda.png"
            alt=""
            width={28}
            height={28}
          />
          <span>Skin &amp; Care</span>
        </div>
        <span className="axv-header-spacer" aria-hidden />
      </header>

      <div className={`axv-scan-wrap ${inSession ? 'axv-scan-wrap--live' : ''}`}>
        <video
          ref={localVideoRef}
          className={inSession ? 'axv-scan-hero' : 'axv-scan-video-hidden'}
          playsInline
          autoPlay
          muted
          aria-label="Your camera"
        />
        {inSession ? (
          <>
            <div ref={remoteVideoContainerRef} className="axv-scan-remotes" aria-label="Other participants" />
            <div className="axv-provider-pip" aria-hidden="true">
              <AgentSphereCanvas
                className="axv-sphere-pip-inner"
                speechLevelRef={speechLevelRef}
                prefersReducedMotion={prefersReducedMotion}
                paused={spherePaused}
              />
            </div>
          </>
        ) : null}
      </div>

      <div className={`axv-body ${inSession ? 'axv-body--session-bar' : ''}`}>
        {!inSession ? (
          <div className="axv-transcript axv-transcript--invite">
            {showLead ? (
              <p className="axv-transcript-lead">Hi — I&apos;m your Skin &amp; Care assistant.</p>
            ) : null}
            <CaptionLine segments={captionSegments} />
            {sending && <p className="axv-caption-status">Thinking…</p>}
          </div>
        ) : (
          <div className="axv-transcript axv-transcript--on-video">
            {showLead ? null : (
              <>
                <CaptionLine segments={captionSegments} />
                {sending && <p className="axv-caption-status">Thinking…</p>}
              </>
            )}
          </div>
        )}

        <LiveKitPanel
          liveKit={liveKit}
          variant="voice"
          localVideoRef={localVideoRef}
          remoteVideoContainerRef={remoteVideoContainerRef}
          embedLocalVideo={false}
        />

        <div className="axv-dock">
          <button
            type="button"
            className="axv-dock-side"
            aria-label="Attach a photo from camera or library (not live video)"
            title="Photo attach — not live video"
            onClick={() => {
              cameraRef.current?.click();
            }}
          >
            <CameraIcon className="ax-heroicon" aria-hidden />
          </button>
          <div className={`axv-mic-wrap ${voiceActive ? 'axv-mic-wrap--active' : ''}`}>
            <span className="axv-mic-ring axv-mic-ring--outer" aria-hidden />
            <span className="axv-mic-ring" aria-hidden />
            <button
              type="button"
              className="axv-mic-hero"
              onClick={() =>
                toggleVoice(() => {
                  onOpenChat();
                })
              }
              aria-pressed={voiceActive}
              disabled={sending}
              aria-label={
                liveKit?.isConnected
                  ? voiceActive
                    ? 'Stop listening (and mute live room mic)'
                    : 'Speak (and unmute live room mic when connected)'
                  : voiceActive
                    ? 'Stop listening'
                    : 'Speak'
              }
            >
              <MicrophoneIcon className="axv-mic-icon" aria-hidden />
            </button>
          </div>
          <button type="button" className="axv-dock-side" aria-label="Open chat" onClick={onOpenChat}>
            <ChatBubbleLeftRightIcon className="ax-heroicon" aria-hidden />
          </button>
        </div>

        <p className="axv-disclaimer">
          Ask about your skin, routine, or ingredients. We analyze your questions and summarize guidance here—this
          isn&apos;t a medical diagnosis. For emergencies, contact your local emergency services.
          <span className="axv-api-hint">
            {apiBase ? ' Connected to API.' : ' Demo mode — set REACT_APP_API_BASE for live replies.'}{' '}
            {inSession
              ? 'Your face fills the screen; the orb is your guide. LiveKit connects when the API is available.'
              : null}
          </span>
        </p>
      </div>
    </div>
  );
}
