import React from 'react';
import ScMark from '../../components/ScMark';

/** Fixed home chip — bottom-right on funnel pages. */
export default function FunnelScOrb() {
  return (
    <a className="sc-orb" href="/" aria-label="Back to Somo home">
      <ScMark className="sc-orb__label" />
    </a>
  );
}
