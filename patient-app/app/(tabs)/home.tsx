import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JournalTokens } from '@/constants/journalTokens';
import { patientGet, patientPost } from '@/lib/patient-api';

type Summary = {
  adherence_pct: number;
  upcoming_checkins: number;
  product_uses_logged: number;
  in_progress: number;
  upcoming: number;
  total_tasks: number;
};

type Card = {
  id: string;
  title: string;
  subtitle: string;
  date_label: string;
  progress_pct: number;
};

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasTemplate, setHasTemplate] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cards, setCards] = useState<Card[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await patientGet('/api/patient/home/progress-summary');
      setHasTemplate(Boolean(data?.has_template));
      setSummary((data?.summary || null) as Summary | null);
      setCards(Array.isArray(data?.cards) ? (data.cards as Card[]) : []);
      void patientPost('/api/patient/analytics/event', { event: 'home_summary_viewed' });
    } catch (e: any) {
      setError(e?.message || 'Unable to load home summary.');
      setHasTemplate(false);
      setSummary(null);
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
        <Text style={styles.title}>Home</Text>
        <Text style={styles.subtitle}>Your routine progress summary and check-ins.</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!hasTemplate && !error ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No routine template yet</Text>
            <Text style={styles.cardBody}>
              Open the Routine tab to create your first template. Once created, Home will show adherence and product
              progress.
            </Text>
          </View>
        ) : null}

        {summary ? (
          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{summary.adherence_pct}%</Text>
              <Text style={styles.metricLabel}>Adherence</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{summary.upcoming_checkins}</Text>
              <Text style={styles.metricLabel}>Check-ins</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{summary.product_uses_logged}</Text>
              <Text style={styles.metricLabel}>Uses logged</Text>
            </View>
          </View>
        ) : null}

        {cards.map((card) => (
          <View key={card.id} style={styles.card}>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.cardBody}>{card.subtitle}</Text>
            <Text style={styles.progress}>{card.date_label} · {card.progress_pct}%</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JournalTokens.color.cream },
  content: { padding: JournalTokens.spacing.lg, gap: JournalTokens.spacing.md },
  title: { fontFamily: JournalTokens.font.display, fontSize: 32, color: JournalTokens.color.ink },
  subtitle: { color: JournalTokens.color.muted, fontFamily: JournalTokens.font.body },
  metricsRow: { flexDirection: 'row', gap: 10 },
  metric: {
    flex: 1,
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: 12,
  },
  metricValue: { fontWeight: '700', fontSize: 20, color: JournalTokens.color.brandBlue },
  metricLabel: { color: JournalTokens.color.muted, fontSize: 12 },
  card: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.lg,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.lg,
    ...JournalTokens.shadow.card,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: JournalTokens.color.ink },
  cardBody: { marginTop: 6, color: JournalTokens.color.muted, lineHeight: 20 },
  progress: { marginTop: 8, color: JournalTokens.color.terracotta, fontWeight: '700' },
  error: { color: '#b91c1c', fontSize: 13, marginTop: 4 },
});
