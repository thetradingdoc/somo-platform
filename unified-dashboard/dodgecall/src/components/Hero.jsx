import { signupUrl } from '../api/dodgecallDemo';

export default function Hero() {
  const scrollToDemo = (e) => {
    e.preventDefault();
    document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <header className="dc-hero">
      <nav className="dc-nav">
        <a href="/" className="dc-logo">
          <span className="dc-logo-s">S</span>
          <span className="dc-logo-rest">omo</span>
        </a>
        <div className="dc-nav-actions">
          <a href={signupUrl()} className="dc-link-muted">Sign up</a>
          <a href="#demo" className="dc-btn dc-btn-light dc-btn-sm" onClick={scrollToDemo}>
            Try Our Live Demo
          </a>
        </div>
      </nav>

      <div className="dc-hero-body">
        <div className="dc-hero-center">
          <p className="dc-eyebrow">Somo — agentic front desk + revenue cycle</p>
          <h1>Never answer business calls again.</h1>
          <p className="dc-hero-sub">
            Somo front desk handles inbound calls like a human receptionist. Somo pay runs eligibility,
            claims, and patient collections — so your team stays off the phone.
          </p>
        </div>

        <div className="dc-hero-bottom">
          <div className="dc-hero-proof">
            <div className="dc-rating-badge">
              <span className="dc-stars" aria-hidden="true">★★★★★</span>
              <span className="dc-rating-score">4.8</span>
              <span className="dc-rating-src">G2</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
