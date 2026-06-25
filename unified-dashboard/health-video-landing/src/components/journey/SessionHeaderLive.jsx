import { LockClosedIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import SomoLogo from '../brand/SomoLogo.jsx';

export default function SessionHeaderLive({
  connStatus,
  statusLabel,
  progressLabel,
  onFinish
}) {
  return (
    <header className="hv-sess-header-live">
      <SomoLogo variant="light" size="nav" />

      <div className="hv-sess-header-center">
        <div className="hv-sess-status hv-sess-status--live">
          {connStatus === 'connecting' || connStatus === 'reconnecting' ? (
            <ArrowPathIcon className="hv-icon hv-icon--sm hv-spin" aria-hidden="true" />
          ) : (
            <span className={`hv-conn-dot hv-conn-dot--live ${connStatus !== 'connected' ? 'connecting' : ''}`} />
          )}
          {statusLabel}
        </div>
        {progressLabel && (
          <span className="hv-sess-header-progress">{progressLabel}</span>
        )}
        <span className="hv-sess-private-inline">
          <LockClosedIcon className="hv-icon hv-icon--xs" aria-hidden="true" />
          Private
        </span>
      </div>

      <button type="button" className="hv-sess-finish-btn" onClick={onFinish}>
        Finish
      </button>
    </header>
  );
}
