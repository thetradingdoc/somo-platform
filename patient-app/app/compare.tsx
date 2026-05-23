import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JournalTokens } from '@/constants/journalTokens';
import { loadCompareBundle, type CompareDayPayload } from '@/lib/routine-compare';

function DayColumn({ label, day }: { label: string; day: CompareDayPayload | null }) {
  if (!day || !day.has_entry) {
    return (
      <View style={styles.col}>
        <Text style={styles.colLabel}>{label}</Text>
        <Text style={styles.empty}>No photo for this day</Text>
      </View>
    );
  }
  const uri = day.thumbnail_url || day.media_url;
  const kicker =
    day.program_week && day.phase_label
      ? `W${day.program_week} · ${day.phase_label}`
      : day.program_week
        ? `W${day.program_week}`
        : day.date;
  return (
    <View style={styles.col}>
      <Text style={styles.colLabel}>{label}</Text>
      <Text style={styles.kicker}>{kicker}</Text>
      {uri ? <Image source={{ uri }} style={styles.photo} resizeMode="cover" /> : null}
      {day.assistant_summary ? <Text style={styles.summary}>{day.assistant_summary}</Text> : null}
    </View>
  );
}

export default function CompareScreen() {
  const params = useLocalSearchParams<{ dateA?: string; dateB?: string }>();
  const dateA = typeof params.dateA === 'string' ? params.dateA : '';
  const dateB = typeof params.dateB === 'string' ? params.dateB : '';
  const [dayA, setDayA] = useState<CompareDayPayload | null>(null);
  const [dayB, setDayB] = useState<CompareDayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!dateA || !dateB) {
      setError('Two dates are required to compare.');
      return;
    }
    setError(null);
    try {
      const bundle = await loadCompareBundle(dateA, dateB);
      setDayA(bundle.day_a);
      setDayB(bundle.day_b);
    } catch (e: any) {
      setError(e?.message || 'Could not load comparison.');
    }
  }, [dateA, dateB]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Compare progress</Text>
        <Text style={styles.sub}>{dateA} vs {dateB}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.row}>
          <DayColumn label="Earlier" day={dayB} />
          <DayColumn label="Later" day={dayA} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JournalTokens.color.cream },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 24, fontWeight: '700', color: JournalTokens.color.ink },
  sub: { color: JournalTokens.color.muted, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 10 },
  col: { flex: 1, backgroundColor: JournalTokens.color.card, borderRadius: 12, padding: 10, gap: 6 },
  colLabel: { fontWeight: '700', fontSize: 12, color: JournalTokens.color.muted },
  kicker: { fontWeight: '600', fontSize: 13, color: JournalTokens.color.ink },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: 8, backgroundColor: '#e2e8f0' },
  summary: { fontSize: 12, color: JournalTokens.color.muted, lineHeight: 16 },
  empty: { fontSize: 12, color: JournalTokens.color.muted },
  error: { color: '#b91c1c' },
});
