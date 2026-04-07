import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AssistantChatPage from './AssistantChatPage';
import AssistantVoicePage from './AssistantVoicePage';
import { useAssistantSession } from './useAssistantSession';
import { useConversationSphereLevel } from './useConversationSphereLevel';
import { useLandingLiveKit } from './useLandingLiveKit';
import { getOrCreateLandingSessionId } from './landingAssistantApi';
import { fetchVisionSessionState, incrementVisionMetric } from './landingLiveKitApi';
import './skin-care-tokens.css';
import './assistant-shared.css';

const HASH_VOICE = '#assistant/voice';
const HASH_CHAT = '#assistant/chat';

function useDocumentHiddenPause() {
  const [hidden, setHidden] = useState(() =>
    typeof document !== 'undefined' ? document.hidden : false
  );
  useEffect(() => {
    const fn = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }, []);
  return hidden;
}

function useVisualViewportKeyboardClass() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const shell = () => document.querySelector('.ax-shell');
    const upd = () => {
      const el = shell();
      if (!el) return;
      const gap = window.innerHeight - vv.height - (vv.offsetTop || 0);
      el.classList.toggle('ax-shell--kb', gap > 72);
    };
    vv.addEventListener('resize', upd);
    vv.addEventListener('scroll', upd);
    upd();
    return () => {
      vv.removeEventListener('resize', upd);
      vv.removeEventListener('scroll', upd);
      const el = shell();
      if (el) el.classList.remove('ax-shell--kb');
    };
  }, []);
}

/**
 * Skin & Care assistant — voice + chat share session, 3D sphere, optional LiveKit (Try now room).
 */
export default function AssistantExperience({ onClose }) {
  const session = useAssistantSession();
  const {
    apiBase,
    messages,
    input,
    setInput,
    attachments,
    setAttachments,
    sending,
    sendUserMessage,
    toggleVoice,
    addFiles,
    interimCaption,
    voiceActive,
    sessionIdRef,
    pushAssistant,
    leadText
  } = session;

  const [page, setPage] = useState(() =>
    typeof window !== 'undefined' && window.location.hash === HASH_CHAT ? 'chat' : 'voice'
  );
  const [visionState, setVisionState] = useState({
    checklist: [],
    guidance: null,
    sessionMetadata: {
      requested_regions: [],
      confirmed_regions: [],
      pending_regions: [],
      failed_regions: []
    }
  });

  const cameraRef = useRef(null);
  const imageRef = useRef(null);
  const fileRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const getSessionId = useCallback(
    () => sessionIdRef.current || getOrCreateLandingSessionId(),
    [sessionIdRef]
  );

  const liveKit = useLandingLiveKit({
    apiBase,
    getSessionId,
    localVideoRef,
    remoteVideoContainerRef: remoteVideoRef,
    assistantPage: page
  });

  useEffect(() => {
    if (liveKit.isConnected) {
      liveKit.syncMicWithVoice(voiceActive);
    }
  }, [voiceActive, liveKit.isConnected, liveKit.syncMicWithVoice]);

  useEffect(() => {
    if (!liveKit?.inSession || !apiBase) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const sid = getSessionId();
        const data = await fetchVisionSessionState({ apiBase, sessionId: sid });
        if (cancelled) return;
        const checklist = Array.isArray(data.checklist) ? data.checklist : [];
        const requested = [...new Set(checklist.map((r) => String(r.requested_region || '').trim()).filter(Boolean))];
        const confirmed = [...new Set(checklist.filter((r) => r.status === 'passed').map((r) => String(r.requested_region || '').trim()).filter(Boolean))];
        const pending = [...new Set(checklist.filter((r) => r.status === 'pending' || r.status === 'capturing' || r.status === 'retry_needed').map((r) => String(r.requested_region || '').trim()).filter(Boolean))];
        const failed = [...new Set(checklist.filter((r) => r.status === 'failed_max_retries').map((r) => String(r.requested_region || '').trim()).filter(Boolean))];
        setVisionState({
          checklist,
          guidance: data.guidance || null,
          sessionMetadata: {
            requested_regions: requested,
            confirmed_regions: confirmed,
            pending_regions: pending,
            failed_regions: failed
          }
        });
      } catch (_) {}
    };
    void poll();
    const id = setInterval(poll, 1800);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [liveKit?.inSession, apiBase, getSessionId]);

  const cameraOffPromptedRef = useRef(false);
  useEffect(() => {
    if (!liveKit?.inSession || !liveKit?.isConnected) {
      cameraOffPromptedRef.current = false;
      return;
    }
    if (!liveKit.cameraEnabled && !cameraOffPromptedRef.current) {
      cameraOffPromptedRef.current = true;
      pushAssistant(
        'I need your camera on to analyze your face accurately. Please tap Start camera so I can continue your skin assessment.',
        { speak: true }
      );
      return;
    }
    if (liveKit.cameraEnabled) {
      cameraOffPromptedRef.current = false;
    }
  }, [liveKit?.inSession, liveKit?.isConnected, liveKit?.cameraEnabled, pushAssistant]);

  const captureGuardPromptedRef = useRef(false);
  useEffect(() => {
    const activeCapture =
      (visionState?.sessionMetadata?.pending_regions || []).length > 0 ||
      (visionState?.checklist || []).some((r) => ['pending', 'capturing', 'retry_needed'].includes(r.status));
    if (!liveKit?.inSession || !activeCapture) {
      captureGuardPromptedRef.current = false;
      return;
    }
    if (!liveKit?.cameraEnabled && !captureGuardPromptedRef.current) {
      captureGuardPromptedRef.current = true;
      pushAssistant(
        'Camera is required to continue this capture checklist. Please tap Start camera so I can verify the requested region.',
        { speak: true }
      );
      void incrementVisionMetric({
        apiBase,
        sessionId: getSessionId(),
        metricName: 'vision.capture.camera_off_incidents'
      }).catch(() => {});
      return;
    }
    if (liveKit?.cameraEnabled) {
      captureGuardPromptedRef.current = false;
    }
  }, [liveKit?.inSession, liveKit?.cameraEnabled, visionState, pushAssistant]);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const docHidden = useDocumentHiddenPause();
  useVisualViewportKeyboardClass();

  const speechLevelRef = useConversationSphereLevel({
    voiceActive,
    interimCaption,
    sending,
    liveKitConnected: liveKit.isConnected
  });

  const setHashForPage = useCallback((next) => {
    const h = next === 'chat' ? HASH_CHAT : HASH_VOICE;
    if (typeof window !== 'undefined' && window.location.hash !== h) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${h}`);
    }
  }, []);

  useEffect(() => {
    const onHash = () => {
      setPage(window.location.hash === HASH_CHAT ? 'chat' : 'voice');
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    setHashForPage(page);
  }, [page, setHashForPage]);

  const handleClose = useCallback(() => {
    liveKit.leaveRoom();
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    onClose();
  }, [liveKit, onClose]);

  const openChat = useCallback(() => setPage('chat'), []);
  const backToVoice = useCallback(() => setPage('voice'), []);

  const ariaLabel =
    page === 'chat' ? 'Skin and Care assistant — chat' : 'Skin and Care assistant — voice';

  return (
    <div className="ax-shell" role="dialog" aria-label={ariaLabel}>
      <div className="ax-hidden-file-root" aria-hidden>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="ax-hidden-input"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={imageRef}
          type="file"
          accept="image/*"
          className="ax-hidden-input"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={fileRef}
          type="file"
          className="ax-hidden-input"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {page === 'voice' ? (
        <AssistantVoicePage
          onClose={handleClose}
          onOpenChat={openChat}
          apiBase={apiBase}
          messages={messages}
          interimCaption={interimCaption}
          voiceActive={voiceActive}
          sending={sending}
          toggleVoice={toggleVoice}
          prefersReducedMotion={prefersReducedMotion}
          cameraRef={cameraRef}
          speechLevelRef={speechLevelRef}
          spherePaused={docHidden}
          liveKit={liveKit}
          localVideoRef={localVideoRef}
          remoteVideoContainerRef={remoteVideoRef}
          visionState={visionState}
          leadText={leadText}
        />
      ) : (
        <AssistantChatPage
          onBack={backToVoice}
          onClose={handleClose}
          messages={messages}
          input={input}
          setInput={setInput}
          attachments={attachments}
          setAttachments={setAttachments}
          sending={sending}
          sendUserMessage={sendUserMessage}
          cameraRef={cameraRef}
          imageRef={imageRef}
          fileRef={fileRef}
          speechLevelRef={speechLevelRef}
          prefersReducedMotion={prefersReducedMotion}
          spherePaused={docHidden}
          liveKit={liveKit}
          localVideoRef={localVideoRef}
          remoteVideoContainerRef={remoteVideoRef}
        />
      )}
    </div>
  );
}
