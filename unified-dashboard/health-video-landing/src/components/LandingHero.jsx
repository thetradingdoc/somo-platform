import BtnPrimary from './brand/BtnPrimary.jsx';

export default function LandingHero() {
  return (
    <section className="hv-hero">
      <span className="hv-marketing-pill">Somo Health</span>
      <h1 className="hv-title">Have a health problem? Ask Somo</h1>
      <p className="hv-lead">
        It&apos;s a free and safe AI health chat. Somo listens, asks follow-up questions,
        and helps you understand next steps — education only, not a diagnosis.
      </p>
      <BtnPrimary className="hv-cta" as="a" href="/health-video/start">
        Call Somo →
      </BtnPrimary>
    </section>
  );
}
