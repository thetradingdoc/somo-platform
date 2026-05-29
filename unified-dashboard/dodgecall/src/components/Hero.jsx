import { signupUrl } from '../api/dodgecallDemo';

export default function Hero() {
  const scrollToDemo = (e) => {
    e.preventDefault();
    document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <header className="dc-hero">
      <nav className="dc-nav">
        <a href="/" className="dc-logo">DodgeCall</a>
        <div className="dc-nav-actions">
          <a href={signupUrl()} className="dc-link-muted">Sign up</a>
          <a href="#demo" className="dc-btn dc-btn-light dc-btn-sm" onClick={scrollToDemo}>
            Try Our Live Demo
          </a>
        </div>
      </nav>

      <div className="dc-hero-body">
        <div className="dc-hero-center">
          <p className="dc-eyebrow">#1 AI voice agent platform for automating calls</p>
          <h1>Meet your AI call center from the future.</h1>
        </div>

        <div className="dc-hero-bottom">
          <div className="dc-hero-proof">
            <div className="dc-rating-badge">
              <span className="dc-stars" aria-hidden="true">★★★★★</span>
              <span className="dc-rating-score">4.8</span>
              <span className="dc-rating-src">G2</span>
            </div>
            <p>
              Build, deploy, and manage next-generation AI voice agents that sound human,
              execute tasks, and scale effortlessly.
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
