import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { JournalTokens } from '@/constants/journalTokens';
import { patientGet } from '@/lib/patient-api';

type TemplateItem = {
  id: string;
  product_name?: string;
  usage_time?: string;
  goal?: string;
};

export default function RoutineScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const selectedDate =
    typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : new Date().toISOString().slice(0, 10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string>('Routine');
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [hasTemplate, setHasTemplate] = useState(false);
  const [completionScore, setCompletionScore] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [templateRes, dailyRes] = await Promise.all([
        patientGet('/api/patient/routine/template'),
        patientGet(`/api/patient/routine/daily?date=${selectedDate}`),
      ]);
      setHasTemplate(Boolean(templateRes?.has_template));
      setTemplateName(templateRes?.template?.name || 'Routine');
      const nextItems = Array.isArray(templateRes?.template?.items) ? (templateRes.template.items as TemplateItem[]) : [];
      setItems(nextItems);
      const score = dailyRes?.daily_entry?.completion_score;
      setCompletionScore(Number.isFinite(Number(score)) ? Number(score) : null);
    } catch (e: any) {
      setError(e?.message || 'Unable to load routine.');
      setHasTemplate(false);
      setItems([]);
      setCompletionScore(null);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
        <Text allowFontScaling style={styles.title}>Routine</Text>
        <Text allowFontScaling style={styles.subtitle}>Template and daily log status for {selectedDate}.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!hasTemplate && !error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No routine template yet</Text>
            <Text style={styles.emptyBody}>Create your template on web Routine flow first, then this screen will sync your steps.</Text>
          </View>
        ) : null}

        {hasTemplate ? (
          <View style={styles.headerCard}>
            <Text style={styles.headerTitle}>{templateName}</Text>
            <Text style={styles.headerSub}>
              Today completion: {completionScore == null ? 'Not logged yet' : `${completionScore}%`}
            </Text>
          </View>
        ) : null}

        {items.map((row, idx) => (
          <View key={row.id || `${row.product_name || 'item'}-${idx}`} style={styles.row}>
            <Text allowFontScaling style={styles.slot}>{String(row.usage_time || 'Any').toUpperCase()}</Text>
            <Text allowFontScaling style={styles.step}>{row.product_name || 'Routine item'}</Text>
            <Text allowFontScaling style={[styles.state, styles.pending]}>
              {row.goal ? 'Goal set' : 'Planned'}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JournalTokens.color.cream },
  content: { padding: JournalTokens.spacing.lg, gap: JournalTokens.spacing.sm },
  title: { fontFamily: JournalTokens.font.display, fontSize: 30, color: JournalTokens.color.ink },
  subtitle: { fontFamily: JournalTokens.font.body, color: JournalTokens.color.muted, marginBottom: JournalTokens.spacing.md },
  headerCard: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.md,
  },
  headerTitle: { fontWeight: '700', color: JournalTokens.color.ink, fontSize: 16 },
  headerSub: { marginTop: 4, color: JournalTokens.color.muted },
  emptyCard: {
    backgroundColor: '#fff7ed',
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: '#fed7aa',
    padding: JournalTokens.spacing.md,
  },
  emptyTitle: { fontWeight: '700', color: '#9a3412' },
  emptyBody: { marginTop: 4, color: '#9a3412' },
  row: {
    minHeight: JournalTokens.minTap,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    backgroundColor: JournalTokens.color.card,
    paddingHorizontal: JournalTokens.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: JournalTokens.spacing.sm,
  },
  slot: { width: 34, fontFamily: JournalTokens.font.body, color: JournalTokens.color.muted, fontWeight: '700' },
  step: { flex: 1, fontFamily: JournalTokens.font.body, color: JournalTokens.color.ink },
  state: { fontFamily: JournalTokens.font.body, fontSize: 12, fontWeight: '700' },
  done: { color: JournalTokens.color.success },
  pending: { color: JournalTokens.color.terracotta },
  error: { color: '#b91c1c', fontSize: 13 },
});

