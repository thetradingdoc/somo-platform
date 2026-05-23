import React from 'react';
import FunnelTrackTriage from './FunnelTrackTriage';

/** Multi-concern capture only — routing happens at Kelly match gate. */
export default function FunnelMatchInquiry(props) {
  return (
    <FunnelTrackTriage
      onCaptureComplete={props.onCaptureComplete}
      onBack={props.onBack}
      onError={props.onError}
    />
  );
}
