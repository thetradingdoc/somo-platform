import { loginUrl, signupUrl } from '../api/somoDemo';
import ScrollCue from './ScrollCue';

const HERO_CHECKS = ['No credit card', 'Setup in minutes', 'Cancel anytime'];

function scrollToDemo(e) {
  e.preventDefault();
  document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' });
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="9" fill="var(--somo-green)" />
      <path
        d="M5.5 9.2 7.8 11.5 12.5 6.8"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Hero() {
  return (
    <header className="somo-hero">
      <nav className="somo-nav">
        <a href="/" className="somo-logo-link" aria-label="Somo home">
          <img
            src="/assets/brand/somo-logo.png"
            alt="Somo"
            className="somo-logo-img"
            fetchPriority="high"
          />
        </a>
        <div className="somo-nav-actions">
          <a href={loginUrl()} className="somo-nav-cta">
            Try for $0
          </a>
        </div>
      </nav>

      <div className="somo-hero-grid">
        <div className="somo-hero-copy">
          <div className="somo-hero-badge">
            <span className="somo-hero-badge-stars" aria-hidden="true">
              ★★★★★
            </span>
            <span>AI Front Desk | 24/7 Calls &amp; Scheduling</span>
          </div>

          <h1>Never answer business calls again.</h1>
          <p className="somo-hero-sub">
            Somo is your smartest assistant. It answers calls, books appointments, and handles billing for dental and medical practices.
          </p>

          <div className="somo-hero-actions">
            <a
              href="#demo"
              className="somo-btn somo-btn-primary somo-btn-demo"
              onClick={scrollToDemo}
            >
              <span className="somo-btn-demo-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M6.6 10.8c1.4 2.8 3.4 4.8 6.2 6.2l2-2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.3 0 .7-.2 1l-2 2.3z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              Try live demo
            </a>
            <a href={signupUrl()} className="somo-btn somo-btn-secondary somo-btn-signup">
              Sign Up
            </a>
          </div>

          <ul className="somo-hero-checks">
            {HERO_CHECKS.map((label) => (
              <li key={label}>
                <CheckIcon />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="somo-hero-visual">
          <img
            src="/assets/brand/hero-phone-v2.jpg"
            alt="Somo app dashboard with multilingual voice agent support"
            className="somo-hero-phone"
            width={1024}
            height={858}
            fetchPriority="high"
          />
        </div>
      </div>
      <ScrollCue />
    </header>
  );
}
