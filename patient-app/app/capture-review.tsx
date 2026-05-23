import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/billing-feedback';
import { PrimaryButton, SecondaryButton } from '@/components/billing-ui';
import { JournalTokens } from '@/constants/journalTokens';
import { confirmBillingDocument, dollarsToCents, extractBillingDocument } from '@/lib/billing-capture';

export default function CaptureReviewScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{ documentId?: string | string[] }>();
  const documentId = (Array.isArray(params.documentId) ? params.documentId[0] : params.documentId) || '';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (!documentId) {
      setLoading(false);
      showToast('Missing document', 'error');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await extractBillingDocument(documentId);
        if (cancelled) return;
        const ex = res.extraction || {};
        setProvider(String(ex.provider_name ?? ''));
        setServiceDate(ex.service_date ? String(ex.service_date) : '');
        setAmount(ex.amount_cents != null && Number.isFinite(Number(ex.amount_cents)) ? (Number(ex.amount_cents) / 100).toFixed(2) : '');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Extract failed';
        showToast(msg, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, showToast]);

  const runConfirm = async (status: 'tracked' | 'needs_review') => {
    if (!documentId || saving) return;
    setSaving(true);
    try {
      const cents = dollarsToCents(amount);
      await confirmBillingDocument(documentId, {
        provider_name: provider.trim() || undefined,
        service_date: serviceDate.trim() || undefined,
        amount_cents: cents ?? undefined,
        status,
        confidence_score: 0.95,
      });
      router.replace({ pathname: '/capture-complete', params: { kind: 'confirm' } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!documentId) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ title: 'Review extraction' }} />
        <Text style={styles.body}>No document to review.</Text>
        <SecondaryButton label="Close" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ title: 'Review extraction' }} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text allowFontScaling style={styles.hint}>
            Reading your document…
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text allowFontScaling style={styles.sub}>
            Confirm provider, date, and amount. Leave fields blank if unknown — you can edit later in the timeline.
          </Text>
          <Text allowFontScaling style={styles.label}>
            Provider
          </Text>
          <TextInput
            value={provider}
            onChangeText={setProvider}
            placeholder="Provider name"
            placeholderTextColor={JournalTokens.color.muted}
            style={styles.input}
            accessibilityLabel="Provider name"
          />
          <Text allowFontScaling style={styles.label}>
            Service date (YYYY-MM-DD)
          </Text>
          <TextInput
            value={serviceDate}
            onChangeText={setServiceDate}
            placeholder="2026-05-01"
            placeholderTextColor={JournalTokens.color.muted}
            style={styles.input}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Service date"
          />
          <Text allowFontScaling style={styles.label}>
            Amount (USD)
          </Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={JournalTokens.color.muted}
            style={styles.input}
            keyboardType="decimal-pad"
            accessibilityLabel="Amount in dollars"
          />
          <PrimaryButton label={saving ? 'Saving…' : 'Confirm & save'} onPress={() => runConfirm('tracked')} />
          <View style={{ height: 10 }} />
          <SecondaryButton label="Save for review later" onPress={() => runConfirm('needs_review')} />
          <View style={{ height: 10 }} />
          <SecondaryButton label="Cancel" onPress={() => router.back()} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JournalTokens.color.card },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  scroll: { padding: JournalTokens.spacing.lg, paddingBottom: 40, gap: 8 },
  sub: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.muted,
    lineHeight: 20,
    marginBottom: 8,
  },
  hint: { fontFamily: JournalTokens.font.body, color: JournalTokens.color.muted, marginTop: 8 },
  body: { fontFamily: JournalTokens.font.body, padding: JournalTokens.spacing.lg },
  label: {
    fontFamily: JournalTokens.font.body,
    fontSize: 13,
    fontWeight: '600',
    color: JournalTokens.color.muted,
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: JournalTokens.font.body,
    fontSize: 16,
    color: JournalTokens.color.ink,
    backgroundColor: '#F8FAFC',
  },
});
