import React, { useEffect, useRef } from 'react';
import {
  CameraIcon,
  ChevronLeftIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  PhotoIcon,
  SparklesIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import AgentSphereCanvas from './AgentSphereCanvas';
import LiveKitPanel from './LiveKitPanel';
import './assistant-shared.css';
import './assistant-chat.css';
import './assistant-livekit.css';

export default function AssistantChatPage({
  onBack,
  onClose,
  messages,
  input,
  setInput,
  attachments,
  setAttachments,
  sending,
  sendUserMessage,
  cameraRef,
  imageRef,
  fileRef,
  speechLevelRef,
  prefersReducedMotion,
  spherePaused,
  liveKit,
  localVideoRef,
  remoteVideoContainerRef
}) {
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onSend = () => sendUserMessage(input);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="axc-root">
      <header className="axc-header">
        <button type="button" className="axc-icon-btn" onClick={onBack} aria-label="Back to voice">
          <ChevronLeftIcon className="ax-heroicon" aria-hidden />
        </button>
        <div className="axc-title-pill">
          <span>Skin &amp; Care</span>
        </div>
        <button type="button" className="axc-icon-btn" onClick={onClose} aria-label="Close assistant">
          <XMarkIcon className="ax-heroicon" aria-hidden />
        </button>
      </header>

      <div className="axc-main-grid">
        <div className="axc-presence-col">
          <AgentSphereCanvas
            className="axc-sphere-wrap"
            speechLevelRef={speechLevelRef}
            prefersReducedMotion={prefersReducedMotion}
            paused={spherePaused}
          />
          <LiveKitPanel
            liveKit={liveKit}
            variant="chat"
            localVideoRef={localVideoRef}
            remoteVideoContainerRef={remoteVideoContainerRef}
          />
        </div>

        <div className="axc-thread-col">
          <div className="axc-messages" ref={listRef} role="log" aria-relevant="additions" aria-label="Chat messages">
            {messages.map((m) => (
              <div key={m.id} className={`axc-bubble axc-bubble--${m.role}`}>
                {m.role === 'assistant' && (
                  <span className="axc-sparkle" aria-hidden>
                    <SparklesIcon className="ax-heroicon ax-heroicon--inline" />
                  </span>
                )}
                <p>{m.text}</p>
              </div>
            ))}
          </div>

          <div className="axc-composer">
            <div className="axc-tools">
              <button
                type="button"
                className="axc-tool-btn"
                aria-label="Take photo (attach, not live video)"
                title="Photo — not live video"
                onClick={() => cameraRef.current?.click()}
              >
                <CameraIcon className="ax-heroicon" aria-hidden />
              </button>
              <button type="button" className="axc-tool-btn" aria-label="Choose from library" onClick={() => imageRef.current?.click()}>
                <PhotoIcon className="ax-heroicon" aria-hidden />
              </button>
              <button type="button" className="axc-tool-btn" aria-label="Attach file" onClick={() => fileRef.current?.click()}>
                <PaperClipIcon className="ax-heroicon" aria-hidden />
              </button>
            </div>
            {attachments.length > 0 && (
              <div className="axc-attachments">
                {attachments.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="axc-chip">
                    {f.name}
                    <button
                      type="button"
                      className="axc-chip-remove"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                    >
                      <XMarkIcon className="ax-heroicon ax-heroicon--xs" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="axc-row">
              <input
                type="text"
                className="axc-input"
                placeholder="Type something…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                aria-label="Message"
                disabled={sending}
              />
              <button type="button" className="axc-send" onClick={onSend} aria-label="Send" disabled={sending}>
                <PaperAirplaneIcon className="ax-heroicon ax-heroicon--send" aria-hidden />
              </button>
            </div>
            <p className="axc-footer-note">
              Ask about your skin, routine, or ingredients. We analyze your questions and summarize guidance here—this
              isn&apos;t a medical diagnosis. For emergencies, contact your local emergency services.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
