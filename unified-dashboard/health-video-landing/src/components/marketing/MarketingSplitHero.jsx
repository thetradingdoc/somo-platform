import BtnPrimary from '../brand/BtnPrimary.jsx';

const HERO_SRC = '/assets/images/health-video-hero.png';

const TRUST_CHIPS = [
  { label: 'Encrypted', variant: 'encrypted' },
  { label: 'You control the camera', variant: 'camera' },
  { label: 'Not a diagnosis', variant: 'disclaimer' }
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
            <span className="hv-marketing-pill">Somo Health</span>

            <h1 className="hv-marketing-title">
              <span className="hv-marketing-title-lead">Have a health problem?</span>
              <br />
              Ask Somo
            </h1>

            <p className="hv-marketing-sub">
              It&apos;s a free and safe AI health chat.
            </p>

            <div className="hv-marketing-trust-chips" aria-label="Trust and safety">
              {TRUST_CHIPS.map(({ label, variant }) => (
                <span
                  key={label}
                  className={`hv-marketing-trust-chip hv-marketing-trust-chip--${variant}`}
                >
                  {label}
                </span>
              ))}
            </div>

            <BtnPrimary className="hv-marketing-cta hv-marketing-cta--main" onClick={onStart}>
              Call Somo →
            </BtnPrimary>

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
          Call Somo →
        </BtnPrimary>
      </div>
    </>
  );
}
