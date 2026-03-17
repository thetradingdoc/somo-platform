import React from 'react';

export function RoleSelect({ query }) {
  const patientUrl = '/patients/patient-login.html';
  const providerUrl = '/login.html';

  return (
    <div className="role-select" aria-label="Choose how to continue">
      <a
        href={patientUrl}
        className="role-btn role-btn--patient"
        aria-label="I'm a patient, go to LittleLab patient portal"
      >
        <span className="role-icon">🧑‍⚕️</span>
        <span className="role-label">I&apos;m a Patient</span>
        <span className="role-sub">
          {query && query.trim().length > 1
            ? 'Continue with this visit'
            : 'Access my LittleLab wallet'}
        </span>
      </a>
      <a
        href={providerUrl}
        className="role-btn role-btn--provider"
        aria-label="I'm a provider, go to LittleLab clinic dashboard"
      >
        <span className="role-icon">🏥</span>
        <span className="role-label">I&apos;m a Provider</span>
        <span className="role-sub">LittleLab clinic dashboard</span>
      </a>
    </div>
  );
}

