import React from 'react';

export function RoleSelect({ query }) {
  // Canonical entrypoints (source of truth)
  const patientUrl = '/unified-dashboard/patients/patient-login.html';
  const providerUrl = '/unified-dashboard/login.html';

  return (
    <div className="role-select" aria-label="Choose how to continue">
      <a
        href={patientUrl}
        className="role-btn role-btn--patient"
        aria-label="I'm a patient, go to Consult patient portal"
      >
        <span className="role-icon">🧑‍⚕️</span>
        <span className="role-label">I&apos;m a Patient</span>
        <span className="role-sub">
          {query && query.trim().length > 1
            ? 'Continue with this visit'
            : 'Access my wallet'}
        </span>
      </a>
      <a
        href={providerUrl}
        className="role-btn role-btn--provider"
        aria-label="I'm a provider, go to Consult provider portal"
      >
        <span className="role-icon">🏥</span>
        <span className="role-label">I&apos;m a Provider</span>
        <span className="role-sub">Consult provider portal</span>
      </a>
    </div>
  );
}

