import React from 'react';
import { primeAssistantAudioGate } from './assistantSpeech';

/**
 * Landing Try-now: invite gate, session toolbar, optional in-panel video (chat).
 * Voice page renders the hero `<video>`; pass `embedLocalVideo={false}` there.
 */
export default function LiveKitPanel({
  liveKit,
  variant,
  localVideoRef,
  remoteVideoContainerRef,
  embedLocalVideo = true
}) {
  const {
    phase,
    entryStep,
    errorMessage,
    permissionHint,
    cameraEnabled,
    beginTryNow,
    leaveRoom,
    retryConnect,
    setCameraOn,
    requestCaptureNow,
    clearPermissionHint
  } = liveKit;

  const busy = phase === 'connecting' || phase === 'reconnecting';
  const connected = phase === 'connected';
  const failed = phase === 'failed';
  const invite = entryStep === 'invite';

  if (invite) {
    return (
      <section className={`ax-lk ax-lk--${variant} ax-lk--invite`} aria-label="Start camera">
        <div className="ax-lk-live-region" aria-live="polite" aria-atomic="true">
          {permissionHint ? <span className="ax-lk-live-msg">{permissionHint}</span> : null}
        </div>
        <div className="ax-lk-invite-card">
          <p className="ax-lk-invite-title">Your camera preview</p>
          <p className="ax-lk-invite-copy">
            We&apos;ll use your camera for this try-on experience. The glowing orb is your Skin &amp; Care guide. You
            can turn the camera off anytime.
          </p>
          <button
            type="button"
            className="ax-lk-btn ax-lk-btn--primary ax-lk-invite-cta"
            onClick={() => {
              primeAssistantAudioGate();
              void beginTryNow();
            }}
            disabled={busy}
          >
            {busy ? 'Starting…' : 'Allow camera & start'}
          </button>
          {permissionHint ? (
            <button type="button" className="ax-lk-btn ax-lk-btn--ghost ax-lk-invite-dismiss" onClick={clearPermissionHint}>
              Dismiss message
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className={`ax-lk ax-lk--${variant}`} aria-label="Live session">
      <div className="ax-lk-live-region" aria-live="polite" aria-atomic="true">
        {failed && errorMessage ? <span className="ax-lk-live-msg">{errorMessage}</span> : null}
        {permissionHint ? <span className="ax-lk-live-msg">{permissionHint}</span> : null}
      </div>

      <div className="ax-lk-toolbar">
        {busy ? (
          <span className="ax-lk-pill" role="status">
            {phase === 'reconnecting' ? 'Reconnecting…' : 'Connecting live…'}
          </span>
        ) : null}
        {connected ? (
          <>
            <span className="ax-lk-pill ax-lk-pill--ok" role="status">
              Live
            </span>
            <button type="button" className="ax-lk-btn" onClick={() => setCameraOn(!cameraEnabled)}>
              {cameraEnabled ? 'Stop camera' : 'Start camera'}
            </button>
            <button type="button" className="ax-lk-btn" onClick={() => requestCaptureNow?.('other')}>
              Capture now
            </button>
            <button type="button" className="ax-lk-btn ax-lk-btn--danger" onClick={leaveRoom}>
              End session
            </button>
          </>
        ) : null}
        {!connected && !busy && failed ? (
          <button type="button" className="ax-lk-btn ax-lk-btn--primary" onClick={retryConnect}>
            Retry live connection
          </button>
        ) : null}
        {!connected && !busy && !failed && entryStep === 'session' ? (
          <span className="ax-lk-pill ax-lk-pill--preview" role="status">
            Preview
          </span>
        ) : null}
        {!connected && !busy && entryStep === 'session' ? (
          <>
            <button type="button" className="ax-lk-btn" onClick={() => setCameraOn(!cameraEnabled)}>
              {cameraEnabled ? 'Stop camera' : 'Start camera'}
            </button>
            <button type="button" className="ax-lk-btn" onClick={() => requestCaptureNow?.('other')}>
              Capture now
            </button>
            <button type="button" className="ax-lk-btn ax-lk-btn--danger" onClick={leaveRoom}>
              End session
            </button>
          </>
        ) : null}
        {permissionHint && !invite ? (
          <button type="button" className="ax-lk-btn ax-lk-btn--ghost" onClick={clearPermissionHint}>
            Dismiss
          </button>
        ) : null}
      </div>

      {embedLocalVideo ? (
        <div className="ax-lk-video-row">
          <video
            ref={localVideoRef}
            className={`ax-lk-local ${connected || entryStep === 'session' ? '' : 'ax-lk-local--hidden'}`}
            muted
            playsInline
            autoPlay
            aria-label="Your camera preview"
          />
          <div
            ref={remoteVideoContainerRef}
            className={`ax-lk-remotes ${connected ? '' : 'ax-lk-remotes--hidden'}`}
            aria-label="Other participants"
          />
        </div>
      ) : null}
    </section>
  );
}
