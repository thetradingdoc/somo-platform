import * as SecureStore from 'expo-secure-store';

export const SESSION_KEY = 'patient_session_id';
export const EMAIL_KEY = 'patient_session_email';
export const API_BASE_KEY = 'patient_api_base_url';

export async function getPatientSessionId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SESSION_KEY);
  } catch {
    return null;
  }
}

export async function clearPatientSession(): Promise<void> {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(SESSION_KEY),
    SecureStore.deleteItemAsync(EMAIL_KEY),
    SecureStore.deleteItemAsync(API_BASE_KEY),
  ]);
}
