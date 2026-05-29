import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';

const PATIENT_SIGNUP_URL = '/patients/patient-login.html?intent=signup';

/** Legacy /app and /join — redirect to patient web auth (server also 302s). */
export default function GetAppBridgePage() {
  useEffect(() => {
    window.location.replace(PATIENT_SIGNUP_URL);
  }, []);

  return (
    <>
      <Helmet>
        <meta httpEquiv="refresh" content={`0;url=${PATIENT_SIGNUP_URL}`} />
        <title>Redirecting…</title>
      </Helmet>
      <p style={{ textAlign: 'center', marginTop: '2rem' }}>
        Redirecting to sign up…{' '}
        <a href={PATIENT_SIGNUP_URL}>Continue</a>
      </p>
    </>
  );
}
