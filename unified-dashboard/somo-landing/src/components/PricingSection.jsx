import { PRICING_SECTION, PRICING_TIERS } from '../content/landingContent';
import { signupUrl } from '../api/somoDemo';

export default function PricingSection() {
  return (
    <section id="pricing" className="somo-section somo-pricing">
      <div className="somo-section-inner">
        <h2 className="somo-section-title">{PRICING_SECTION.title}</h2>
        <p className="somo-section-lead">{PRICING_SECTION.lead}</p>
        <div className="somo-pricing-grid">
          {PRICING_TIERS.map((tier) => {
            const ctaLabel = tier.ctaLabel ?? (tier.popular ? 'Start free trial' : 'Get started');
            const ctaClass = tier.isFree
              ? 'somo-btn somo-btn-free somo-pricing-cta'
              : tier.popular
                ? 'somo-btn somo-btn-primary somo-pricing-cta'
                : 'somo-btn somo-btn-secondary somo-pricing-cta';
            return (
              <article
                key={tier.id}
                className={`somo-pricing-card${tier.popular ? ' somo-pricing-card-popular' : ''}${
                  tier.isFree ? ' somo-pricing-card--free' : ''
                }`}
              >
                {tier.isFree && <span className="somo-pricing-badge somo-pricing-badge-start">Start here</span>}
                {tier.popular && !tier.isFree && (
                  <span className="somo-pricing-badge">Most popular</span>
                )}
                <p className="somo-pricing-tier">{tier.healthcareLabel}</p>
                <h3 className="somo-pricing-name">{tier.name}</h3>
                <p className="somo-pricing-price">
                  ${tier.price}
                  <span>{tier.price === 0 ? ' to start' : '/mo'}</span>
                </p>
                <ul className="somo-pricing-features">
                  {tier.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <a href={tier.isFree ? signupUrl() : signupUrl(tier.id)} className={ctaClass}>
                  {ctaLabel}
                </a>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
