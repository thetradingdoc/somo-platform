import { useRef, useState, useCallback, useEffect } from 'react';
import { VideoCameraIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import BtnPrimary from '../brand/BtnPrimary.jsx';
import { SelfPreviewPlaceholder } from './SelfPip.jsx';

export default function SessionPreview({
  displayName,
  connecting,
  onContinue,
  onEnableCameraForLive
}) {
  const previewVideoRef = useRef(null);
  const streamRef = useRef(null);
  const [previewCam, setPreviewCam] = useState(false);
  const [loadingCam, setLoadingCam] = useState(false);
  const [error, setError] = useState('');

  const startPreviewCam = useCallback(async () => {
    setLoadingCam(true);
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false
      });
      streamRef.current = stream;
      setPreviewCam(true);
    } catch (e) {
      setError(e.message || 'Could not access camera');
    } finally {
      setLoadingCam(false);
    }
  }, []);

  useEffect(() => {
    if (previewCam && streamRef.current && previewVideoRef.current) {
      previewVideoRef.current.srcObject = streamRef.current;
    }
  }, [previewCam]);

  const stopPreviewStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
  }, []);

  const handleContinue = (withCamera) => {
    stopPreviewStream();
    if (withCamera) {
      onEnableCameraForLive?.();
    }
    onContinue?.();
  };

  const greeting = displayName?.trim()
    ? `Almost ready, ${displayName.trim()}`
    : 'Almost ready';

  return (
    <div className="hv-session-preview hv-fade-in">
      <div className="hv-preview-header">
        {connecting && (
          <span className="hv-preview-connecting">
            <ArrowPathIcon className="hv-icon hv-icon--sm hv-spin" aria-hidden="true" />
            Connecting in background…
          </span>
        )}
      </div>

      <h2 className="hv-step-title">{greeting}</h2>
      <p className="hv-step-sub">
        Check your camera and lighting. Somo isn&apos;t listening yet — you can start with camera off.
      </p>

      <div className="hv-preview-video-wrap">
        {previewCam ? (
          <video
            ref={previewVideoRef}
            autoPlay
            playsInline
            muted
            className="hv-preview-video"
          />
        ) : (
          <SelfPreviewPlaceholder onEnableCamera={startPreviewCam} loading={loadingCam} />
        )}
        {previewCam && (
          <div className="hv-preview-live-badge">
            <VideoCameraIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
            Preview only
          </div>
        )}
      </div>

      {error && <p className="hv-error">{error}</p>}

      <div className="hv-preview-actions">
        <BtnPrimary onClick={() => handleContinue(previewCam)}>
          Continue to Somo →
        </BtnPrimary>
        {!previewCam && (
          <button
            type="button"
            className="hv-journey-btn hv-journey-btn-secondary"
            onClick={() => handleContinue(false)}
          >
            Skip — start without camera
          </button>
        )}
      </div>
    </div>
  );
}
