import { TRUST_BADGES } from '../content/landingContent';

function BadgeIcon({ id }) {
  const common = { width: 32, height: 32, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };
  if (id === 'hipaa') {
    return (
      <svg {...common}>
        <path
          d="M12 2 4 5v6c0 5.25 3.4 10.15 8 11.35 4.6-1.2 8-6.1 8-11.35V5L12 2z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (id === 'encrypted') {
    return (
      <svg {...common}>
        <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === 'billing') {
    return (
      <svg {...common}>
        <path
          d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function TrustBar() {
  return (
    <section className="somo-trust-section" aria-label="Compliance and trust">
      <div className="somo-trust-badges">
        {TRUST_BADGES.map((badge) => (
          <div key={badge.id} className="somo-trust-badge">
            <span className="somo-trust-badge-icon">
              <BadgeIcon id={badge.id} />
            </span>
            <div className="somo-trust-badge-text">
              <strong>{badge.title}</strong>
              <span>{badge.sub}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
