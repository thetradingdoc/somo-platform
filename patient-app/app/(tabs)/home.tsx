import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillingV1 } from '@/constants/billingV1';
import { BillingTheme } from '@/constants/billingTheme';
import { JournalTokens } from '@/constants/journalTokens';
import { LoadingCard, ErrorCard, OfflineBanner, useToast } from '@/components/billing-feedback';
import { patientGet } from '@/lib/patient-api';

type BillingEvent = {
  id: string;
  title: string;
  provider_name: string | null;
  amount_cents: number | null;
  service_date: string | null;
  status: string;
  confidence_score: number | null;
};

export default function HomeScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    setError(null);
    setOffline(false);
    try {
      const data = await patientGet('/api/patient/billing/events?limit=100');
      const rows = Array.isArray(data?.events) ? (data.events as BillingEvent[]) : [];
      setEvents(rows);
      setLastUpdated(new Date().toISOString());
      if (mode === 'refresh') showToast('Home updated', 'success');
    } catch (e: any) {
      const msg = e?.message || 'Unable to load billing action center.';
      setError(msg);
      setOffline(/network request failed|offline|network/i.test(msg));
      setEvents([]);
      showToast('Load failed. Retry when ready.', 'error');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const derived = useMemo(() => {
    const now = Date.now();
    const dueNow = events.filter((e) => e.status === 'due').length;
    const upcoming7 = events.filter((e) => {
      if (!e.service_date) return false;
      const t = new Date(`${e.service_date}T00:00:00`).getTime();
      return t >= now && t <= now + 7 * 24 * 60 * 60 * 1000;
    }).length;
    const upcoming30 = events.filter((e) => {
      if (!e.service_date) return false;
      const t = new Date(`${e.service_date}T00:00:00`).getTime();
      return t >= now && t <= now + 30 * 24 * 60 * 60 * 1000;
    }).length;
    const needsReview = events.filter((e) => e.status === 'needs_review').length;
    const alerts = events.filter((e) => e.status === 'disputed').length;
    const missingDocs = events.filter((e) => (e.confidence_score ?? 0) < 0.7).length;
    return { dueNow, upcoming7, upcoming30, needsReview, alerts, missingDocs };
  }, [events]);

  const actionCards = [
    { id: 'due', title: 'Due now', subtitle: 'Outstanding balances requiring action', value: derived.dueNow, route: '/(tabs)/timeline', params: { status: 'due' } },
    { id: 'upcoming', title: 'Upcoming 7/30', subtitle: `${derived.upcoming7} in 7 days · ${derived.upcoming30} in 30 days`, value: derived.upcoming30, route: '/(tabs)/timeline', params: { status: 'tracked' } },
    { id: 'alerts', title: 'Problem alerts', subtitle: 'Declines, disputes, or mismatches', value: derived.alerts, route: '/(tabs)/money', params: { section: 'now' } },
    { id: 'missing', title: 'Missing docs', subtitle: 'Low-confidence events to review', value: derived.missingDocs + derived.needsReview, route: '/(tabs)/timeline', params: { status: 'needs_review' } },
  ] as const;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />}>
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Home</Text>
          <Text style={styles.subtitle}>Action center for billing tracking, risks, and next steps.</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroTitle}>V1 goal locked</Text>
          <Text style={styles.heroBody}>{BillingV1.successMetric}</Text>
          <Text style={styles.heroMeta}>
            Statuses: {BillingV1.lifecycleStatuses.join(', ')} · Plan: Free (limited scans) / Plus (unlimited)
          </Text>
        </View>

        {offline ? <OfflineBanner message={BillingV1.copy.offline} /> : null}

        {loading ? (
          <>
            <LoadingCard label="Loading action center..." />
            <LoadingCard label="Loading upcoming work..." />
          </>
        ) : null}

        {error ? <ErrorCard title="Unable to load Home" message={error} onRetry={() => void load('refresh')} retryLabel={BillingV1.copy.genericRetry} /> : null}

        {!loading && !error && events.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{BillingV1.copy.emptyHomeTitle}</Text>
            <Text style={styles.cardBody}>{BillingV1.copy.emptyHomeBody}</Text>
            <Pressable style={styles.cta} onPress={() => router.push('/scan-entry')}>
              <Text style={styles.ctaText}>First capture</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error
          ? actionCards.map((card) => (
              <Pressable
                key={card.id}
                style={styles.card}
                onPress={() => router.push({ pathname: card.route, params: card.params as Record<string, string> })}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardTitle}>{card.title}</Text>
                  <Text style={styles.metricValue}>{card.value}</Text>
                </View>
                <Text style={styles.cardBody}>{card.subtitle}</Text>
              </Pressable>
            ))
          : null}
        {lastUpdated ? <Text style={styles.lastUpdated}>Last updated {new Date(lastUpdated).toLocaleTimeString()}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JournalTokens.color.cream },
  content: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 10,
  },
  headerBlock: {
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: JournalTokens.color.line,
  },
  title: {
    fontFamily: JournalTokens.font.display,
    fontSize: 28,
    fontWeight: '600',
    color: JournalTokens.color.ink,
  },
  subtitle: {
    color: JournalTokens.color.muted,
    fontFamily: JournalTokens.font.body,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  hero: {
    backgroundColor: BillingTheme.color['color.status.info.bg'],
    borderRadius: JournalTokens.radius.lg,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.lg,
  },
  heroTitle: {
    fontFamily: JournalTokens.font.display,
    fontSize: BillingTheme.typography.cardTitle,
    fontWeight: '400',
    letterSpacing: -0.5,
    color: BillingTheme.color['color.status.info.fg'],
  },
  heroBody: { marginTop: 6, color: BillingTheme.color['color.text.primary'], lineHeight: 20, fontFamily: JournalTokens.font.body },
  heroMeta: { marginTop: 8, color: JournalTokens.color.muted, fontSize: 12, fontFamily: JournalTokens.font.body },
  metricValue: { fontWeight: '700', fontSize: 20, color: JournalTokens.color.brandBlue },
  card: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.lg,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.lg,
    ...JournalTokens.shadow.card,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: JournalTokens.color.ink },
  cardBody: { marginTop: 6, color: JournalTokens.color.muted, lineHeight: 20 },
  cta: {
    marginTop: 12,
    minHeight: JournalTokens.minTap,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: BillingTheme.button.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  ctaText: { color: BillingTheme.button.primaryText, fontFamily: JournalTokens.font.body, fontWeight: '700' },
  lastUpdated: { color: JournalTokens.color.muted, fontSize: 11, fontFamily: JournalTokens.font.body },
});
