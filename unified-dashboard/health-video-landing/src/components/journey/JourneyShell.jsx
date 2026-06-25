import SomoLogo from '../brand/SomoLogo.jsx';

export default function JourneyShell({
  children,
  navLabel = 'Health chat',
  onBack,
  footer,
  dark = false
}) {
  return (
    <div className={`hv-journey-shell ${dark ? 'hv-journey-shell--dark' : ''}`}>
      <div className="hv-journey-frame">
        <header className="hv-journey-nav">
          <SomoLogo variant={dark ? 'dark' : 'light'} size={dark ? 'sm' : 'nav'} />
          {onBack ? (
            <button type="button" className="hv-journey-nav-back" onClick={onBack}>
              ← Back
            </button>
          ) : (
            <span className="hv-journey-nav-label">{navLabel}</span>
          )}
        </header>
        <main className="hv-journey-body hv-fade-in">{children}</main>
        {footer}
      </div>
    </div>
  );
}

export function EmergencyFooter() {
  return (
    <p className="hv-emergency-line">
      If this is an emergency, call your local emergency number.
    </p>
  );
}
