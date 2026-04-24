import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { JournalTokens } from '@/constants/journalTokens';
import { patientGet } from '@/lib/patient-api';
import { clearPatientSession } from '@/lib/patient-session';

type SupportConfig = {
  support?: { phone?: string; email?: string; hours?: string };
  timezone?: string;
};

type PatientMe = {
  patient?: { id?: string; name?: string };
  onboarding?: { onboarding_complete?: boolean };
};

export default function InsightsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [support, setSupport] = useState<SupportConfig | null>(null);
  const [me, setMe] = useState<PatientMe | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, m] = await Promise.all([patientGet('/api/patient/support-config'), patientGet('/api/patient/me')]);
      setSupport(s as SupportConfig);
      setMe(m as PatientMe);
    } catch (e: any) {
      setError(e?.message || 'Unable to load account details.');
      setSupport(null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function signOut() {
    await clearPatientSession();
    router.replace('/(tabs)/home');
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
        <Text allowFontScaling style={styles.title}>More</Text>
        <Text allowFontScaling style={styles.subtitle}>Profile, clinic support, and session controls.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.card}>
          <Text allowFontScaling style={styles.cardTitle}>Profile</Text>
          <Text allowFontScaling style={styles.cardBody}>
            Name: {me?.patient?.name || 'Patient'}
            {'\n'}
            ID: {me?.patient?.id || '—'}
            {'\n'}
            Onboarding: {me?.onboarding?.onboarding_complete ? 'Complete' : 'In progress'}
          </Text>
        </View>

        <View style={styles.lockCard}>
          <Text allowFontScaling style={styles.lockTitle}>Clinic support</Text>
          <Text allowFontScaling style={styles.lockBody}>
            Phone: {support?.support?.phone || 'Not available'}
            {'\n'}
            Email: {support?.support?.email || 'Not available'}
            {'\n'}
            Hours: {support?.support?.hours || 'Not available'}
            {'\n'}
            Timezone: {support?.timezone || '—'}
          </Text>
        </View>

        <Pressable style={styles.signOutBtn} onPress={signOut} accessibilityRole="button" accessibilityLabel="Sign out">
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JournalTokens.color.cream },
  content: { padding: JournalTokens.spacing.lg, gap: JournalTokens.spacing.md },
  title: { fontFamily: JournalTokens.font.display, fontSize: 30, color: JournalTokens.color.ink },
  subtitle: { fontFamily: JournalTokens.font.body, color: JournalTokens.color.muted },
  card: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.lg,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.lg,
    ...JournalTokens.shadow.card,
  },
  cardTitle: { fontFamily: JournalTokens.font.body, fontWeight: '700', fontSize: 17, color: JournalTokens.color.ink },
  cardBody: { marginTop: JournalTokens.spacing.sm, color: JournalTokens.color.ink, fontFamily: JournalTokens.font.body, lineHeight: 21 },
  lockCard: {
    backgroundColor: '#F6F0E6',
    borderRadius: JournalTokens.radius.lg,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.lg,
  },
  lockTitle: { fontFamily: JournalTokens.font.body, fontWeight: '700', color: JournalTokens.color.ink, fontSize: 16 },
  lockBody: { marginTop: JournalTokens.spacing.sm, color: JournalTokens.color.muted, fontFamily: JournalTokens.font.body, lineHeight: 20 },
  signOutBtn: {
    minHeight: JournalTokens.minTap,
    borderRadius: JournalTokens.radius.md,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { color: '#fff', fontWeight: '700' },
  error: { color: '#b91c1c', fontSize: 13 },
});

