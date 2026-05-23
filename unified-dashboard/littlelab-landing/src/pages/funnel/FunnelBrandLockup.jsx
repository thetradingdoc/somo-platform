import React from 'react';
import HeaderBrandLockup from '../../components/HeaderBrandLockup';

/** Funnel header brand — delegates to shared 114×32 lockup. */
export default function FunnelBrandLockup({ asLink = true, className = '' }) {
  return (
    <HeaderBrandLockup
      href="/"
      asLink={asLink}
      className={`funnel-brand-lockup ${className}`.trim()}
    />
  );
}
