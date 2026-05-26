import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton } from '@/components/billing-ui';
import { JournalTokens } from '@/constants/journalTokens';
import { patientGet } from '@/lib/patient-api';
import { clearPatientSession, getPatientSessionId } from '@/lib/patient-session';
import * as SecureStore from 'expo-secure-store';

const EMAIL_KEY = 'patient_session_email';

export default function AccountScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [programName, setProgramName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sid = await getPatientSessionId();
      if (!sid) {
        setSignedIn(false);
        setEmail(null);
        setProgramName(null);
        return;
      }
      setSignedIn(true);
      const storedEmail = await SecureStore.getItemAsync(EMAIL_KEY);
      setEmail(storedEmail);
      const template = await patientGet('/api/patient/routine/template').catch(() => null);
      if (template?.has_template && template?.template?.name) {
        setProgramName(String(template.template.name));
      } else {
        setProgramName(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = useCallback(async () => {
    await clearPatientSession();
    setSignedIn(false);
    setEmail(null);
    setProgramName(null);
    router.replace('/(tabs)/index');
  }, [router]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Account</Text>

        {loading ? (
          <ActivityIndicator color={JournalTokens.color.accent} />
        ) : !signedIn ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in</Text>
            <Text style={styles.cardBody}>
              Sign in with your email to sync your routine, progress photos, and clinic visits.
            </Text>
            <PrimaryButton label="Sign in" onPress={() => router.push('/(tabs)/index')} />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              {email ? <Text style={styles.email}>{email}</Text> : null}
              {programName ? (
                <Text style={styles.program}>Program: {programName}</Text>
              ) : (
                <Text style={styles.programMuted}>No active routine program</Text>
              )}
            </View>

            <Pressable
              style={styles.linkRow}
              onPress={() => router.push('/(tabs)/money')}
              accessibilityRole="button">
              <Text style={styles.linkLabel}>Bills & receipts</Text>
              <Text style={styles.linkChevron}>›</Text>
            </Pressable>

            <SecondaryButton label="Change program" onPress={() => router.push('/routine/pick')} />
            <View style={{ height: 12 }} />
            <SecondaryButton label="Sign out" onPress={() => void signOut()} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JournalTokens.color.cream },
  content: { padding: JournalTokens.spacing.lg, gap: 14 },
  title: { fontFamily: JournalTokens.font.display, fontSize: 28, color: JournalTokens.color.ink },
  card: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.md,
    gap: 6,
  },
  cardTitle: { fontWeight: '700', fontSize: 17, color: JournalTokens.color.ink },
  cardBody: { color: JournalTokens.color.muted, lineHeight: 20 },
  email: { fontSize: 15, color: JournalTokens.color.ink, fontWeight: '600' },
  program: { fontSize: 14, color: JournalTokens.color.muted, marginTop: 4 },
  programMuted: { fontSize: 14, color: JournalTokens.color.muted, fontStyle: 'italic' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.md,
    minHeight: JournalTokens.minTap,
  },
  linkLabel: { fontSize: 16, fontWeight: '600', color: JournalTokens.color.ink },
  linkChevron: { fontSize: 22, color: JournalTokens.color.muted },
});
