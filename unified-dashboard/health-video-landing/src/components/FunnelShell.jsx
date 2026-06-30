import { Link } from 'react-router-dom';

const LOGO_SRC = '/assets/brand/somo-logo.png';

export default function FunnelShell({
  step = 1,
  totalSteps = 3,
  stepLabel,
  children,
  footer
}) {
  const pct = Math.round((step / totalSteps) * 100);
  return (
    <div className="hv-shell">
      <header className="hv-top-bar">
        <Link to="/" className="hv-logo-link" aria-label="Somo home">
          <img className="hv-logo-img" src={LOGO_SRC} alt="Somo" />
        </Link>
      </header>
      <main className="hv-wizard hv-fade-in">
        {stepLabel && (
          <div className="hv-progress-wrap">
            <div className="hv-progress-meta">Step {step} of {totalSteps} — {stepLabel}</div>
            <div className="hv-progress-track">
              <div className="hv-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {children}
      </main>
      {footer}
    </div>
  );
}

export function DisclaimerFooter() {
  return (
    <p className="hv-disclaimer">
      Educational health chat only — not a diagnosis or prescription service.
      For emergencies, call local emergency services.
    </p>
  );
}
