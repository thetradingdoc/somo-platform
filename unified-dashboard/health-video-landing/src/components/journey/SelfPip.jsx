import { VideoCameraSlashIcon } from '@heroicons/react/24/outline';

const FULL_VARIANTS = new Set(['stage-full', 'desktop-full']);

export default function SelfPip({ videoRef, camOn, variant = 'stage', className = '' }) {
  const isFull = FULL_VARIANTS.has(variant);

  if (!camOn && isFull) return null;

  return (
    <div
      className={`hv-self-pip hv-self-pip--${variant} ${camOn ? 'on' : 'off'} ${className}`.trim()}
      aria-label={camOn ? 'Your camera preview' : 'Camera off'}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`hv-self-pip-video ${camOn ? '' : 'hv-visually-hidden'}`}
      />
      {!camOn && (
        <div className="hv-self-pip-placeholder" aria-hidden="true">
          <VideoCameraSlashIcon className="hv-icon hv-icon--sm" />
        </div>
      )}
    </div>
  );
}

export function SelfPreviewPlaceholder({ onEnableCamera, loading }) {
  return (
    <div className="hv-self-preview-placeholder">
      <VideoCameraSlashIcon className="hv-icon hv-icon--lg" aria-hidden="true" />
      <p>Camera is off — Somo can&apos;t see you until you turn it on.</p>
      <button type="button" className="hv-journey-btn hv-journey-btn-secondary" onClick={onEnableCamera} disabled={loading}>
        Turn camera on
      </button>
    </div>
  );
}
