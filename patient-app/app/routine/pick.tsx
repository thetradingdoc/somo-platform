import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/billing-ui';
import { JournalTokens } from '@/constants/journalTokens';
import { PENDING_ROUTINE_CONCERN_KEY } from '@/constants/routineSession';
import { patientPost, publicGet } from '@/lib/patient-api';
import { getPatientSessionId } from '@/lib/patient-session';

type ConcernRow = {
  id: string;
  label: string;
  total_weeks: number;
};

type ProgramPreview = {
  key_rules?: string[];
};

export default function RoutinePickScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ concern?: string }>();
  const [concerns, setConcerns] = useState<ConcernRow[]>([]);
  const [selected, setSelected] = useState('acne');
  const [preview, setPreview] = useState<ProgramPreview | null>(null);
  const [loadingConcerns, setLoadingConcerns] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConcerns = useCallback(async () => {
    setLoadingConcerns(true);
    setError(null);
    try {
      const data = await publicGet('/api/public/routines/concerns');
      const list: ConcernRow[] = Array.isArray(data?.concerns) ? data.concerns : [];
      setConcerns(list);
      const paramId = typeof params.concern === 'string' ? params.concern : '';
      const initial =
        paramId && list.some((c) => c.id === paramId) ? paramId : list[0]?.id || 'acne';
      setSelected(initial);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load care plans.');
    } finally {
      setLoadingConcerns(false);
    }
  }, [params.concern]);

  useEffect(() => {
    void loadConcerns();
  }, [loadConcerns]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await publicGet(`/api/public/routines/${encodeURIComponent(selected)}/preview`);
        if (!cancelled) setPreview(data?.preview || null);
      } catch {
        if (!cancelled) setPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function startTracking() {
    setBusy(true);
    setError(null);
    try {
      const sid = await getPatientSessionId();
      if (!sid) {
        await SecureStore.setItemAsync(PENDING_ROUTINE_CONCERN_KEY, selected);
        router.replace('/(tabs)');
        return;
      }
      await patientPost('/api/patient/routine/template', { concern_id: selected });
      await SecureStore.deleteItemAsync(PENDING_ROUTINE_CONCERN_KEY);
      router.replace('/(tabs)/today');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not start routine.');
    } finally {
      setBusy(false);
    }
  }

  const selectedRow = concerns.find((c) => c.id === selected);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Choose your routine</Text>
        <Text style={styles.sub}>
          Pick a guided template to track AM/PM steps and daily progress photos.
        </Text>
        {loadingConcerns ? <ActivityIndicator /> : null}
        {concerns.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => setSelected(c.id)}
            style={[styles.card, selected === c.id && styles.cardSelected]}>
            <Text style={styles.cardTitle}>{c.label}</Text>
            <Text style={styles.cardMeta}>{c.total_weeks} weeks · guided program</Text>
          </Pressable>
        ))}
        {preview && selectedRow ? (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>Key rules</Text>
            {(preview.key_rules || []).slice(0, 4).map((rule) => (
              <Text key={rule} style={styles.rule}>
                · {rule}
              </Text>
            ))}
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton
          label={busy ? 'Starting…' : 'Start tracking'}
          onPress={() => void startTracking()}
        />
        {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JournalTokens.color.cream },
  content: { padding: JournalTokens.spacing.lg, gap: JournalTokens.spacing.md },
  title: {
    fontFamily: JournalTokens.font.display,
    fontSize: 28,
    color: JournalTokens.color.ink,
  },
  sub: { fontFamily: JournalTokens.font.body, color: JournalTokens.color.muted },
  card: {
    padding: JournalTokens.spacing.md,
    borderRadius: JournalTokens.radius.lg,
    backgroundColor: JournalTokens.color.card,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
  },
  cardSelected: { borderColor: JournalTokens.color.brandAccent, borderWidth: 2 },
  cardTitle: {
    fontFamily: JournalTokens.font.body,
    fontWeight: '700',
    fontSize: 17,
    color: JournalTokens.color.ink,
  },
  cardMeta: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.muted,
    marginTop: 4,
  },
  preview: { gap: 6 },
  previewTitle: {
    fontFamily: JournalTokens.font.body,
    fontWeight: '600',
    color: JournalTokens.color.ink,
  },
  rule: { fontFamily: JournalTokens.font.body, color: JournalTokens.color.muted, fontSize: 14 },
  error: { color: '#b91c1c', fontFamily: JournalTokens.font.body },
});
