import { useEffect, useRef } from 'react';
import { useMicSpeechLevel } from './useMicSpeechLevel';
import { assistantSpeakingRef } from './sphereConversationBridge';

/**
 * Single 0–1 level for the plasma sphere: mic (your voice), interim transcript,
 * “thinking” while the API runs, and TTS while Kelly speaks.
 */
export function useConversationSphereLevel({ voiceActive, interimCaption, sending, liveKitConnected }) {
  const micRef = useMicSpeechLevel(voiceActive);
  const levelRef = useRef(0);
  const voiceActiveRef = useRef(voiceActive);
  const interimRef = useRef(interimCaption);
  const sendingRef = useRef(sending);
  const lkRef = useRef(!!liveKitConnected);
  voiceActiveRef.current = voiceActive;
  interimRef.current = interimCaption;
  sendingRef.current = sending;
  lkRef.current = !!liveKitConnected;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const mic = typeof micRef.current === 'number' ? micRef.current : 0;
      let target = mic;

      if (sendingRef.current) {
        const pulse = 0.36 + 0.1 * Math.sin(performance.now() / 460);
        target = Math.max(target, pulse);
      }

      const interim = String(interimRef.current || '').trim();
      if (interim) {
        const capBump = Math.min(0.14, interim.length / 350);
        target = Math.max(target, 0.3 + capBump);
      }

      if (assistantSpeakingRef.current) {
        const pulse = 0.45 + 0.12 * Math.sin(performance.now() / 340);
        target = Math.max(target, pulse);
      }

      if (lkRef.current) {
        const lk = 0.1 + 0.06 * Math.sin(performance.now() / 880);
        target = Math.max(target, lk);
      }

      if (
        voiceActiveRef.current &&
        !interim &&
        !sendingRef.current &&
        !assistantSpeakingRef.current
      ) {
        const breathe = 0.12 + 0.07 * Math.sin(performance.now() / 720);
        target = Math.max(target, breathe);
      }

      const next = Math.min(1, target);
      levelRef.current += (next - levelRef.current) * 0.2;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [micRef]);

  return levelRef;
}
