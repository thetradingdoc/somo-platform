import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { PrimaryButton, SecondaryButton } from '@/components/billing-ui';
import { BillingTheme } from '@/constants/billingTheme';
import { JournalTokens } from '@/constants/journalTokens';
import { patientGet, patientPost } from '@/lib/patient-api';
import { clearPatientSession } from '@/lib/patient-session';

type SupportConfig = {
  support?: { phone?: string; email?: string; hours?: string };
  timezone?: string;
};

type PatientMe = {
  patient?: { id?: string; name?: string };
  onboarding?: { onboarding_complete?: boolean };
};

type PlanTier = 'free' | 'plus';

export default function InsightsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [support, setSupport] = useState<SupportConfig | null>(null);
  const [me, setMe] = useState<PatientMe | null>(null);
  const [planTier, setPlanTier] = useState<PlanTier>('free');
  const [pricing, setPricing] = useState<{ monthly_price_cents?: number; annual_price_cents?: number; trial_days?: number } | null>(null);
  const [retentionDays, setRetentionDays] = useState(365);
  const [autoDelete, setAutoDelete] = useState(false);
  const [deleteRequestStatus, setDeleteRequestStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, m, sub, retention] = await Promise.all([
        patientGet('/api/patient/support-config'),
        patientGet('/api/patient/me'),
        patientGet('/api/patient/billing/subscription'),
        patientGet('/api/patient/billing/retention-policy'),
      ]);
      setSupport(s as SupportConfig);
      setMe(m as PatientMe);
      setPlanTier(sub?.subscription?.tier === 'plus' ? 'plus' : 'free');
      setPricing(sub?.pricing_policy?.plus || null);
      setRetentionDays(Number(retention?.retention_policy?.retain_days || 365));
      setAutoDelete(Boolean(retention?.retention_policy?.auto_delete_enabled));
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

  async function saveRetentionPolicy(nextDays: number, nextAutoDelete: boolean) {
    await patientPost('/api/patient/billing/retention-policy', {
      retain_days: nextDays,
      auto_delete_enabled: nextAutoDelete,
    });
    setRetentionDays(nextDays);
    setAutoDelete(nextAutoDelete);
  }

  async function requestDataDeletion() {
    const data = await patientPost('/api/patient/billing/data-deletion-request', { reason: 'profile_request' });
    setDeleteRequestStatus(String(data?.deletion_request?.status || 'queued'));
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
        <View style={styles.headerBlock}>
          <Text allowFontScaling style={styles.title}>
            Profile
          </Text>
          <Text allowFontScaling style={styles.subtitle}>
            Account, subscription, support, and privacy controls.
          </Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.planCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Subscription</Text>
            <View style={[styles.badge, planTier === 'plus' ? styles.badgeInfo : styles.badgeNeutral]}>
              <Text style={[styles.badgeText, planTier === 'plus' ? styles.badgeTextInfo : styles.badgeTextNeutral]}>
                {planTier === 'plus' ? 'Plus' : 'Free'}
              </Text>
            </View>
          </View>
          <Text style={styles.cardBody}>
            {planTier === 'plus'
              ? 'Unlimited scans are active on your Plus subscription.'
              : 'You are on Free plan. Upgrade to Plus for unlimited scans and full reconciliation tools.'}
          </Text>
          {pricing ? (
            <Text style={styles.pricingMeta}>
              Plus pricing locked: ${(Number(pricing.monthly_price_cents || 0) / 100).toFixed(2)}/mo or $
              {(Number(pricing.annual_price_cents || 0) / 100).toFixed(2)}/yr with {Number(pricing.trial_days || 0)}-day trial.
            </Text>
          ) : null}
          <View style={styles.rowBetween}>
            <View style={styles.actionBtnWrap}>
              <PrimaryButton label={planTier === 'plus' ? 'Manage plan' : 'Upgrade to Plus'} onPress={() => {}} />
            </View>
            <View style={styles.actionBtnWrap}>
              <SecondaryButton label="Plan details" onPress={() => {}} />
            </View>
          </View>
        </View>

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

        <View style={styles.card}>
          <Text allowFontScaling style={styles.cardTitle}>Account controls</Text>
          <View style={styles.controlRow}>
            <Text style={styles.controlText}>Notifications and reminders</Text>
            <Text style={styles.controlAction}>Manage</Text>
          </View>
          <View style={styles.controlRow}>
            <Text style={styles.controlText}>Data export</Text>
            <Text style={styles.controlAction}>Request</Text>
          </View>
          <View style={styles.controlRow}>
            <Text style={styles.controlText}>Data deletion</Text>
            <Text style={styles.controlAction}>Request</Text>
          </View>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Retention and deletion workflow</Text>
          <Text style={styles.cardBody}>
            Configure retention window and request full deletion. Deletion requests are queued for compliance review.
          </Text>
          <View style={styles.controlRow}>
            <Text style={styles.controlText}>Retention window</Text>
            <View style={styles.inlineActions}>
              <Pressable onPress={() => void saveRetentionPolicy(180, autoDelete)}><Text style={styles.controlAction}>180d</Text></Pressable>
              <Pressable onPress={() => void saveRetentionPolicy(365, autoDelete)}><Text style={styles.controlAction}>365d</Text></Pressable>
              <Pressable onPress={() => void saveRetentionPolicy(730, autoDelete)}><Text style={styles.controlAction}>730d</Text></Pressable>
            </View>
          </View>
          <View style={styles.controlRow}>
            <Text style={styles.controlText}>Auto-delete</Text>
            <Pressable onPress={() => void saveRetentionPolicy(retentionDays, !autoDelete)}>
              <Text style={styles.controlAction}>{autoDelete ? 'Enabled' : 'Disabled'}</Text>
            </Pressable>
          </View>
          <View style={styles.controlRow}>
            <Text style={styles.controlText}>Deletion request</Text>
            <Pressable onPress={() => void requestDataDeletion()}>
              <Text style={styles.controlAction}>Submit</Text>
            </Pressable>
          </View>
          <Text style={styles.pricingMeta}>
            Current: retain {retentionDays} days · auto-delete {autoDelete ? 'on' : 'off'} · request status {deleteRequestStatus || 'none'}.
          </Text>
        </View>
        <View style={styles.card}>
          <Text allowFontScaling style={styles.cardTitle}>Household and dependents (future)</Text>
          <Text style={styles.cardBody}>
            Add family members and dependents so bills can be linked to the right person while keeping one payment and
            document workflow.
          </Text>
          <View style={styles.controlRow}>
            <Text style={styles.controlText}>Household member management</Text>
            <Text style={styles.controlAction}>Coming soon</Text>
          </View>
          <View style={styles.controlRow}>
            <Text style={styles.controlText}>Dependent billing assignment</Text>
            <Text style={styles.controlAction}>Coming soon</Text>
          </View>
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
  content: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 120,
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
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  card: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.lg,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.lg,
    ...JournalTokens.shadow.card,
  },
  cardTitle: { fontFamily: JournalTokens.font.body, fontWeight: '700', fontSize: BillingTheme.typography.cardTitle, color: JournalTokens.color.ink },
  cardBody: { marginTop: JournalTokens.spacing.sm, color: JournalTokens.color.ink, fontFamily: JournalTokens.font.body, lineHeight: 21 },
  pricingMeta: { marginTop: 8, color: '#185FA5', fontFamily: JournalTokens.font.body, fontSize: 12, lineHeight: 18 },
  planCard: {
    backgroundColor: '#F2F8FF',
    borderRadius: JournalTokens.radius.lg,
    borderWidth: 1,
    borderColor: '#B5D4F4',
    padding: JournalTokens.spacing.lg,
  },
  badge: {
    borderRadius: 20,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badgeText: { fontSize: 11, fontWeight: '700', fontFamily: JournalTokens.font.body },
  badgeInfo: { backgroundColor: '#E6F1FB' },
  badgeTextInfo: { color: '#0C447C' },
  badgeNeutral: {
    backgroundColor: '#F2F5FA',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D1D5DB',
  },
  badgeTextNeutral: { color: '#6B7280' },
  actionBtnWrap: { marginTop: 12, flex: 1 },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: JournalTokens.color.line,
  },
  controlText: { color: JournalTokens.color.ink, fontFamily: JournalTokens.font.body, fontSize: 13 },
  controlAction: { color: '#185FA5', fontFamily: JournalTokens.font.body, fontSize: 12, fontWeight: '700' },
  inlineActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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

