import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { API_BASE_URL } from '@/config';

const API_BASE = API_BASE_URL;
const SESSION_KEY = 'patient_session_id';

// ngrok free tier returns HTML interstitial unless this header is sent
const API_HEADERS: HeadersInit = {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
};
const EMAIL_KEY = 'patient_session_email';

type Appointment = {
  id: string;
  patient_name: string;
  appointment_type: string;
  date: string;
  time: string;
  status: string;
  datetime_display?: string;
  video_room?: string;
};

type Step = 'email' | 'code' | 'appointments';

const { width } = Dimensions.get('window');
const CARD_MAX_WIDTH = 400;
const HORIZONTAL_PADDING = Math.max(16, (width - Math.min(width, CARD_MAX_WIDTH)) / 2);

export default function HomeScreen() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('patient@doclittle.com');
  const [code, setCode] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [restoring, setRestoring] = useState(true);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);

  // Restore session on mount so reload shows appointments
  useEffect(() => {
    (async () => {
      try {
        const [sid, storedEmail] = await Promise.all([
          SecureStore.getItemAsync(SESSION_KEY),
          SecureStore.getItemAsync(EMAIL_KEY),
        ]);
        if (sid && storedEmail) {
          setSessionId(sid);
          setEmail(storedEmail);
          setStep('appointments');
        }
      } catch {
        // ignore
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  const loadAppointments = useCallback(async (sid?: string) => {
    const effectiveSessionId = sid ?? sessionId;
    if (!effectiveSessionId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/api/patient/appointments`, {
        headers: { ...API_HEADERS, 'x-session-id': effectiveSessionId },
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Failed to load appointments');
        return;
      }
      setAppointments(json.appointments || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Load appointments when we have a session and are on appointments step
  useEffect(() => {
    if (!restoring && step === 'appointments' && sessionId) {
      loadAppointments(sessionId);
    }
  }, [restoring, step, sessionId, loadAppointments]);

  async function sendCode() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/api/patient/verify/send`, {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Failed to send verification code');
        return;
      }
      // Store initial session id (backend may reuse it on confirm)
      if (json.session_id) setSessionId(json.session_id);
      setStep('code');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/api/patient/verify/confirm`, {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Invalid verification code');
        return;
      }
      const sid = json.session_id as string;
      setSessionId(sid);
      await SecureStore.setItemAsync(SESSION_KEY, sid);
      await SecureStore.setItemAsync(EMAIL_KEY, email.trim());
      await loadAppointments(sid);
      setStep('appointments');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  // Allow joining video for any appointment - every appointment has a video room (appt-{id})
  const canJoinVideo = (_apt: Appointment) => true;

  function joinVideoVisit(appointmentId: string, videoRoom?: string) {
    if (!appointmentId) return;
    const room = videoRoom || `appt-${appointmentId}`;
    const base = API_BASE.replace(/\/$/, '');
    const params = new URLSearchParams({
      room,
      name: 'Bala (mobile)',
      api: API_BASE,
    });
    const url = `${base}/patients/video-call.html?${params.toString()}`;
    Linking.openURL(url).catch(() => {
      setError('Could not open video visit link on this device.');
    });
  }

  async function handleSignOut() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await SecureStore.deleteItemAsync(EMAIL_KEY);
    setSessionId(null);
    setAppointments([]);
    setStep('email');
    setError(null);
  }

  const inputStyle = {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: Platform.OS === 'ios' ? 14 : 12,
    marginTop: 8,
    marginBottom: 16,
    fontSize: 16,
  };

  const btnStyle = (disabled: boolean, primary = true) => ({
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: disabled ? '#d1d5db' : primary ? '#0d9488' : '#6b7280',
    alignItems: 'center' as const,
  });

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}>
        <ThemedView style={{ flex: 1, paddingHorizontal: HORIZONTAL_PADDING, paddingBottom: 24 }}>
          <ThemedText type="title" style={{ marginTop: 8, marginBottom: 8 }}>
            DocLittle
          </ThemedText>
          <ThemedText style={{ fontSize: 14, opacity: 0.7, marginBottom: 16 }}>
            Patient Portal
          </ThemedText>

      {step === 'email' && (
        <View style={{ marginTop: 8 }}>
          <ThemedText style={{ fontWeight: "600", marginBottom: 4 }}>Email</ThemedText>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="your@email.com"
            placeholderTextColor="#9ca3af"
            style={inputStyle}
          />
          <TouchableOpacity
            onPress={sendCode}
            disabled={loading}
            style={btnStyle(loading)}
            activeOpacity={0.8}>
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <ThemedText style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>
                Send verification code
              </ThemedText>
            )}
          </TouchableOpacity>
        </View>
      )}

      {step === 'code' && (
        <View style={{ marginTop: 8 }}>
          <ThemedText style={{ fontWeight: '600', marginBottom: 4 }}>
            Enter the 6‑digit code sent to {email}
          </ThemedText>
          <TextInput
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="000000"
            placeholderTextColor="#9ca3af"
            style={[inputStyle, { letterSpacing: 12, textAlign: 'center' }]}
          />
          <TouchableOpacity
            onPress={confirmCode}
            disabled={loading || code.trim().length !== 6}
            style={btnStyle(loading || code.trim().length !== 6)}
            activeOpacity={0.8}>
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <ThemedText style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>
                Verify & view appointments
              </ThemedText>
            )}
          </TouchableOpacity>
        </View>
      )}

      {step === 'appointments' && (
        <View style={{ flex: 1, marginTop: 8 }}>
          {restoring ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" />
              <ThemedText style={{ marginTop: 12 }}>Restoring session…</ThemedText>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <ThemedText type="subtitle">
                  My Appointments{loading ? ' (loading…)' : ''}
                </ThemedText>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => loadAppointments()}
                    disabled={loading}
                    style={[btnStyle(loading, false), { paddingVertical: 10, paddingHorizontal: 14 }]}
                    activeOpacity={0.8}>
                    <ThemedText style={{ color: '#fff', fontSize: 14 }}>Reload</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSignOut}
                    style={[btnStyle(false, false), { paddingVertical: 10, paddingHorizontal: 14 }]}
                    activeOpacity={0.8}>
                    <ThemedText style={{ color: '#fff', fontSize: 14 }}>Sign out</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 24 }}
                showsVerticalScrollIndicator={false}>
                {appointments.length === 0 ? (
                  <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                    <ThemedText style={{ textAlign: 'center', opacity: 0.8 }}>
                      No appointments found.
                    </ThemedText>
                    <ThemedText style={{ textAlign: 'center', marginTop: 8, fontSize: 14, opacity: 0.6 }}>
                      Use the same email when creating appointments in the provider portal.
                    </ThemedText>
                  </View>
                ) : (
                  appointments.map((apt) => {
                    const isSelected = selectedAppointment?.id === apt.id;
                    const video = canJoinVideo(apt);
                    return (
                      <TouchableOpacity
                        key={apt.id}
                        onPress={() => setSelectedAppointment(isSelected ? null : apt)}
                        activeOpacity={0.8}
                        style={{
                          padding: 16,
                          marginBottom: 12,
                          borderRadius: 16,
                          borderWidth: 2,
                          borderColor: isSelected ? '#0d9488' : video ? '#0f766e' : '#e5e7eb',
                          backgroundColor: isSelected ? (video ? '#ccfbf1' : '#f0fdfa') : (video ? '#ecfdf5' : '#f9fafb'),
                        }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <View style={{ flex: 1 }}>
                            <ThemedText type="defaultSemiBold" lightColor="#111827" darkColor="#111827" style={{ fontSize: 16 }}>
                              {apt.appointment_type || 'Consultation'}
                            </ThemedText>
                            <ThemedText lightColor="#374151" darkColor="#374151" style={{ marginTop: 4 }}>
                              {apt.datetime_display || `${apt.date} at ${apt.time}`}
                            </ThemedText>
                            <View
                              style={{
                                marginTop: 6,
                                alignSelf: 'flex-start',
                                paddingHorizontal: 8,
                                paddingVertical: 2,
                                borderRadius: 6,
                                backgroundColor: apt.status === 'confirmed' ? '#d1fae5' : apt.status === 'cancelled' ? '#fee2e2' : '#e0f2fe',
                              }}>
                              <ThemedText lightColor="#374151" darkColor="#374151" style={{ fontSize: 12, textTransform: 'capitalize' }}>
                                {apt.status}
                              </ThemedText>
                            </View>
                          </View>
                          <ThemedText lightColor="#6b7280" darkColor="#6b7280" style={{ fontSize: 12 }}>
                            {isSelected ? '▼ Tap to collapse' : '▶ Tap for details'}
                          </ThemedText>
                        </View>
                        {isSelected && (
                          <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)' }}>
                            {video && (
                              <TouchableOpacity
                                onPress={() => joinVideoVisit(apt.id, apt.video_room)}
                                style={[btnStyle(false), { marginBottom: 8 }]}
                                activeOpacity={0.8}>
                                <ThemedText style={{ color: '#fff', fontWeight: '600' }}>
                                  Join Video Visit
                                </ThemedText>
                              </TouchableOpacity>
                            )}
                            <Pressable onPress={() => setSelectedAppointment(null)}>
                              <ThemedText lightColor="#6b7280" darkColor="#6b7280" style={{ fontSize: 14 }}>
                                Close
                              </ThemedText>
                            </Pressable>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </>
          )}
        </View>
      )}

      {error && (
        <View style={{ marginTop: 16, padding: 12, backgroundColor: '#fee2e2', borderRadius: 12 }}>
          <ThemedText style={{ color: '#b91c1c', fontSize: 14 }}>Error: {error}</ThemedText>
        </View>
      )}
        </ThemedView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
