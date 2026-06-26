import { useCallback, useEffect, useRef } from 'react';

const INTERVAL_MS = 5000;
const MAX_FRAMES = 3;

function captureVideoFrame(videoEl, quality = 0.75) {
  if (!videoEl?.videoWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
  return base64;
}

export function useFrameCapture({ roomId, videoRef, agentSecret, enabled, region, onCaption, onError }) {
  const timerRef = useRef(null);
  const countRef = useRef(0);
  const activeRef = useRef(false);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    countRef.current = 0;
  }, []);

  const postFrame = useCallback(async () => {
    const videoEl = videoRef.current;
    const base64 = captureVideoFrame(videoEl);
    if (!base64 || !roomId) return;

    const headers = { 'Content-Type': 'application/json' };
    if (agentSecret) headers['X-Video-Consult-Secret'] = agentSecret;

    try {
      const res = await fetch('/api/video-consult/agent-events', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          room: roomId,
          event: 'vision_frame',
          payload: {
            image_base64: base64,
            requested_region: region || 'general',
            frame_quality: 'good',
            is_patient: true,
            timestamp: new Date().toISOString()
          }
        })
      });
      const data = await res.json();
      if (data?.caption?.caption) {
        onCaption?.({ caption: data.caption.caption, source: data.caption.source });
      } else if (data?.caption) {
        onCaption?.({ caption: data.caption, source: data.source });
      }
      countRef.current += 1;
      if (countRef.current >= MAX_FRAMES) stop();
    } catch (e) {
      onError?.(e.message);
      stop();
    }
  }, [roomId, videoRef, agentSecret, region, onCaption, onError, stop]);

  const start = useCallback(() => {
    stop();
    activeRef.current = true;
    countRef.current = 0;
    postFrame();
    timerRef.current = setInterval(() => {
      if (!activeRef.current || countRef.current >= MAX_FRAMES) {
        stop();
        return;
      }
      postFrame();
    }, INTERVAL_MS);
  }, [postFrame, stop]);

  useEffect(() => {
    if (!enabled) stop();
    return () => stop();
  }, [enabled, stop]);

  return { start, stop };
}
