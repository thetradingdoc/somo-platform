import { Link } from 'react-router-dom';

export default function LandingHero() {
  return (
    <section>
      <p className="hv-eyebrow">Safe VideoGPT for Healthcare</p>
      <h1 className="hv-title">Talk to Kelly — your Somo health assistant</h1>
      <p className="hv-sub">
        Start with a quick video health chat. Kelly listens, asks follow-up questions,
        and can guide you to show a skin concern on camera — all in plain language.
      </p>
      <Link to="/consent" className="hv-btn hv-btn-primary">
        Start health chat
      </Link>
    </section>
  );
}
