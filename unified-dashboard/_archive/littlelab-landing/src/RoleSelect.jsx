import React from 'react';

export function RoleSelect({ query, variant = 'soft' }) {
  // Canonical entrypoints (source of truth)
  const patientUrl = '/unified-dashboard/patients/patient-login.html';
  const providerUrl = '/unified-dashboard/login.html';

  return (
    <section className="role-cta" aria-label="Join our network">
      <p className="role-cta-title">Join our network</p>
      <div className="role-select" aria-label="Choose portal access">
        <a
          href={providerUrl}
          className={`role-btn role-btn--provider role-btn--${variant}`}
          aria-label="Open Doctors portal"
        >
          <span className="role-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
              <path d="M17 3v4" />
              <path d="M15 5h4" />
            </svg>
          </span>
          <span className="role-label">Doctors portal</span>
          <span className="role-sub">Practice dashboard access</span>
        </a>
        <a
          href={patientUrl}
          className={`role-btn role-btn--patient role-btn--${variant}`}
          aria-label="Open Patients portal"
        >
          <span className="role-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </span>
          <span className="role-label">Patients portal</span>
          <span className="role-sub">
            {query && query.trim().length > 1 ? 'Continue with this visit' : 'Access your wallet'}
          </span>
        </a>
      </div>
    </section>
  );
}

