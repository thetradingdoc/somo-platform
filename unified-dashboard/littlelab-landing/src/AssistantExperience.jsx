import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AssistantChatPage from './AssistantChatPage';
import AssistantVoicePage from './AssistantVoicePage';
import { useAssistantSession } from './useAssistantSession';
import './skin-care-tokens.css';
import './assistant-shared.css';

const HASH_VOICE = '#assistant/voice';
const HASH_CHAT = '#assistant/chat';

/**
 * Skin & Care assistant — two surfaces (same theme as marketing landing via `skin-care-tokens.css`):
 * - Page 1 (voice): white shell, sphere (transparent WebGL), transcript, amber mic — `AssistantVoicePage`
 * - Page 2 (chat): cream message area, white composer, amber send — `AssistantChatPage`
 *
 * Hash routing: `#assistant/voice` | `#assistant/chat` (replaceState, no full navigation).
 * Session + messages live in `useAssistantSession` (shared across pages).
 *
 * API: `POST /api/public/landing-assistant/turn` when `resolveMiddlewareApiBase()` is set.
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
    voiceActive
  } = session;

  const [page, setPage] = useState(() =>
    typeof window !== 'undefined' && window.location.hash === HASH_CHAT ? 'chat' : 'voice'
  );

  const cameraRef = useRef(null);
  const imageRef = useRef(null);
  const fileRef = useRef(null);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

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
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    onClose();
  }, [onClose]);

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
        />
      )}
    </div>
  );
}
