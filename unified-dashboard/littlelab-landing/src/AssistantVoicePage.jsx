import React, { useMemo } from 'react';
import { useConversationSphereLevel } from './useConversationSphereLevel';
import { Canvas } from '@react-three/fiber';
import { CameraIcon, ChatBubbleLeftRightIcon, ChevronLeftIcon, MicrophoneIcon } from '@heroicons/react/24/outline';
import { MagicPlasmaScene } from './MagicPlasmaSphere';
import { segmentCaptionWithKeywordEmphasis } from './captionEmphasis';
import './assistant-shared.css';
import './assistant-voice.css';

function CaptionLine({ segments }) {
  return (
    <p className="axv-live-caption" aria-live="polite">
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
  cameraRef
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

  const showLead =
    !interimCaption && !voiceActive && !lastAssistantText;

  const speechLevelRef = useConversationSphereLevel({
    voiceActive,
    interimCaption,
    sending
  });

  return (
    <div className="axv-root">
      <header className="axv-header">
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

      <div className="axv-body">
        <div className="axv-sphere-wrap" aria-hidden="true">
          {!prefersReducedMotion ? (
            <Canvas
              className="axv-canvas"
              camera={{ position: [0, 0, 1.52], fov: 75, near: 0.1, far: 100 }}
              gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
              dpr={[1, 2]}
              onCreated={({ gl }) => {
                gl.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2));
                gl.setClearColor(0x000000, 0);
              }}
            >
              <MagicPlasmaScene speechLevelRef={speechLevelRef} />
            </Canvas>
          ) : (
            <div className="axv-sphere-fallback" />
          )}
        </div>

        <div className="axv-transcript">
          {showLead ? (
            <p className="axv-transcript-lead">Hi — I&apos;m your Skin &amp; Care assistant.</p>
          ) : null}
          <CaptionLine segments={captionSegments} />
          {sending && <p className="axv-caption-status">Thinking…</p>}
        </div>

        <div className="axv-dock">
          <button
            type="button"
            className="axv-dock-side"
            aria-label="Camera or photo library"
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
              aria-label={voiceActive ? 'Stop listening' : 'Speak'}
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
          {apiBase ? (
            <span className="axv-api-hint"> Connected to API.</span>
          ) : (
            <span className="axv-api-hint"> Demo mode — set REACT_APP_API_BASE for live replies.</span>
          )}
        </p>
      </div>
    </div>
  );
}
