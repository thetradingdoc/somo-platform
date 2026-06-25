import BtnPrimary from '../brand/BtnPrimary.jsx';

const HERO_SRC = '/assets/images/health-video-hero.jpg';

const TRUST_CHIPS = [
  'Encrypted',
  'You control the camera',
  'Not a diagnosis'
];

export default function MarketingSplitHero({ onStart }) {
  return (
    <>
      <div className="hv-marketing-split">
        <div className="hv-marketing-visual" aria-hidden="true">
          <img src={HERO_SRC} alt="" className="hv-marketing-hero-img" />
        </div>

        <div className="hv-marketing-copy">
          <div className="hv-marketing-copy-main">
            <span className="hv-marketing-pill">Private AI health guide</span>

            <h1 className="hv-marketing-title">
              Talk to Kelly about
              <br />
              what&apos;s bothering you
            </h1>

            <p className="hv-marketing-sub">
              Free, in your language. Type, speak, or show your camera — only when you want to.
            </p>

            <BtnPrimary className="hv-marketing-cta hv-marketing-cta--main" onClick={onStart}>
              Start health chat →
            </BtnPrimary>

            <div className="hv-marketing-trust-chips" aria-label="Trust and safety">
              {TRUST_CHIPS.map((label) => (
                <span key={label} className="hv-marketing-trust-chip">{label}</span>
              ))}
            </div>

            <p className="hv-marketing-legal">
              By continuing you agree to our{' '}
              <a href="/health-terms.html">terms</a> and{' '}
              <a href="/health-privacy.html">privacy policy</a>.
            </p>
          </div>
        </div>
      </div>

      <div className="hv-marketing-sticky-cta">
        <BtnPrimary className="hv-marketing-cta" onClick={onStart}>
          Start health chat →
        </BtnPrimary>
      </div>
    </>
  );
}
