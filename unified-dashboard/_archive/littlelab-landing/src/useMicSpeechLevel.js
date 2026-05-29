import { useEffect, useRef } from 'react';

/**
 * While `active`, samples the microphone and writes a 0–1 level into the returned ref (RMS, lightly smoothed).
 * Runs alongside Web Speech API recognition (separate MediaStream in most browsers).
 * If the mic cannot be opened, falls back to a gentle pulse so the sphere still reacts while listening.
 */
export function useMicSpeechLevel(active) {
  const levelRef = useRef(0);

  useEffect(() => {
    if (!active) {
      levelRef.current = 0;
      return undefined;
    }

    let stream = null;
    let ctx = null;
    let analyser = null;
    let dataArray = null;
    let raf = 0;
    let cancelled = false;

    const runLoop = (fn) => {
      const tick = () => {
        if (cancelled) return;
        fn();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        try {
          await ctx.resume();
        } catch (_) {}
        const source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        dataArray = new Uint8Array(analyser.fftSize);

        runLoop(() => {
          if (!analyser || !dataArray) return;
          analyser.getByteTimeDomainData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const v = (dataArray[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          const boosted = Math.min(1, rms * 4.2);
          levelRef.current = levelRef.current * 0.82 + boosted * 0.18;
        });
      } catch (_) {
        runLoop(() => {
          levelRef.current = 0.12 + 0.08 * Math.sin(performance.now() / 320);
        });
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
      levelRef.current = 0;
    };
  }, [active]);

  return levelRef;
}
