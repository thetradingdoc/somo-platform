import Constants from 'expo-constants';

// API base for the patient app — must be reachable from the device running Expo Go.
//
// Required on a physical phone: set `EXPO_PUBLIC_API_BASE_URL` in `patient-app/.env`:
//   - Same URL as `ngrok http 4000` (HTTPS), e.g. https://xxxx.ngrok-free.app
//   - Or same Wi‑Fi: http://YOUR_MAC_LAN_IP:4000
//
// iOS Simulator on Mac: http://127.0.0.1:4000 works if middleware runs locally.
// Restart Expo with `npx expo start --clear` after changing `.env`.
//
// Demo patient (Jeremiah in local DB): set EXPO_PUBLIC_DEMO_PATIENT_EMAIL to the email
// stored on `appointments.patient_email` for that patient (see your provider portal / DB).

const rawBase = (process.env.EXPO_PUBLIC_API_BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);

export const API_BASE_URL = rawBase;

/** Optional: pre-fill login email (e.g. same as appointment row in middleware). */
export const DEMO_PATIENT_EMAIL =
  (process.env.EXPO_PUBLIC_DEMO_PATIENT_EMAIL || '').trim();

/** Default product id for Explore → checkout-chat deep link (must exist in merchant catalog). */
export const DEMO_CHECKOUT_PRODUCT_ID = (
  process.env.EXPO_PUBLIC_DEMO_PRODUCT_ID || 'prod-vitamin-c-serum-antioxidant-pro-shield'
).trim();

/** Optional merchant/provider id for public catalog API when opening checkout chat from the app. */
export const DEMO_PROVIDER_ID = (process.env.EXPO_PUBLIC_MERCHANT_ID || '').trim();

/**
 * On a real device, localhost/127.0.0.1 points at the phone — every fetch fails with "Network request failed".
 */
export function getApiReachabilityIssue(): string | null {
  const isLocalHost = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(API_BASE_URL);
  if (isLocalHost && Constants.isDevice) {
    return (
      'API URL is localhost, which does not work on a physical phone. ' +
      'Add patient-app/.env with EXPO_PUBLIC_API_BASE_URL=https://YOUR-ngrok-url (or http://YOUR-MAC-IP:4000), ' +
      'then restart Expo with --clear.'
    );
  }
  return null;
}
