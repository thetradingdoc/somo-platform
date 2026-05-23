import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorCard, LoadingCard, OfflineBanner, useToast } from '@/components/billing-feedback';
import { JournalTokens } from '@/constants/journalTokens';
import { TimelineTokens } from '@/constants/timelineTokens';
import { patientGet } from '@/lib/patient-api';

export default function MoneyScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [dueCents, setDueCents] = useState(0);
  const [paidCents, setPaidCents] = useState(0);
  const [needsReview, setNeedsReview] = useState(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      setError(null);
      setOffline(false);
      try {
        const data = await patientGet('/api/patient/billing/money-summary');
        const s = data?.snapshots || {};
        setDueCents(Number(s.due_cents || 0));
        setPaidCents(Number(s.paid_cents || 0));
        setNeedsReview(Number(s.needs_review_count || 0));
        if (mode === 'refresh') showToast('Money summary updated', 'success');
      } catch (e: any) {
        const msg = e?.message || 'Unable to load money summary.';
        setError(msg);
        setOffline(/network request failed|offline|network/i.test(msg));
        showToast('Could not load Money', 'error');
      } finally {
        setRefreshing(false);
        setLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const fmt = (cents: number) =>
    `$${(Math.max(0, cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />}>
        <View style={styles.headerBlock}>
          <Text allowFontScaling style={styles.title}>
            Money
          </Text>
          <Text allowFontScaling style={styles.subtitle}>
            Outstanding balances, paid totals, and review queue from your tracked bills.
          </Text>
        </View>
        {offline ? <OfflineBanner message="You appear offline." /> : null}
        {loading ? <LoadingCard label="Loading summary..." /> : null}
        {error ? (
          <ErrorCard title="Unable to load Money" message={error} onRetry={() => void load('refresh')} retryLabel="Retry" />
        ) : null}
        {!loading && !error ? (
          <Pressable style={styles.captureCta} onPress={() => router.push('/scan-entry')} accessibilityRole="button">
            <Text style={styles.captureCtaText}>Capture receipt or bill</Text>
          </Pressable>
        ) : null}
        {!loading && !error ? (
          <View style={styles.grid}>
            <View style={styles.stat}>
              <Text style={[styles.statVal, { color: TimelineTokens.amountOwe }]}>{fmt(dueCents)}</Text>
              <Text style={styles.statLbl}>Total due</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statVal, { color: TimelineTokens.amountPaid }]}>{fmt(paidCents)}</Text>
              <Text style={styles.statLbl}>Paid (tracked)</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statVal, { color: TimelineTokens.amountPending }]}>{needsReview}</Text>
              <Text style={styles.statLbl}>Needs review</Text>
            </View>
          </View>
        ) : null}
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
    fontFamily: JournalTokens.font.body,
    fontSize: 18,
    fontWeight: '500',
    color: JournalTokens.color.ink,
  },
  subtitle: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stat: {
    flex: 1,
    minWidth: '28%',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 0,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  statVal: {
    fontSize: 18,
    fontWeight: '500',
    fontFamily: JournalTokens.font.body,
  },
  statLbl: {
    marginTop: 2,
    fontSize: 10,
    color: JournalTokens.color.muted,
    fontFamily: JournalTokens.font.body,
  },
  captureCta: {
    minHeight: JournalTokens.minTap,
    borderRadius: 10,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginBottom: 4,
  },
  captureCtaText: {
    color: '#ffffff',
    fontFamily: JournalTokens.font.body,
    fontWeight: '700',
    fontSize: 15,
  },
});
