import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/billing-feedback';
import { PrimaryButton, SecondaryButton } from '@/components/billing-ui';
import { JournalTokens } from '@/constants/journalTokens';
import { createBillingEvent, dollarsToCents } from '@/lib/billing-capture';

export default function CaptureManualBillScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [provider, setProvider] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [amount, setAmount] = useState('');

  const save = async () => {
    const t = title.trim() || provider.trim() || 'Bill';
    setBusy(true);
    try {
      await createBillingEvent({
        event_type: 'bill',
        title: t,
        provider_name: provider.trim() || null,
        service_date: serviceDate.trim() || null,
        amount_cents: dollarsToCents(amount),
        status: 'needs_review',
      });
      router.replace({ pathname: '/capture-complete', params: { kind: 'manual_bill' } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not save';
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ title: 'Add bill manually' }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text allowFontScaling style={styles.label}>
          Title (optional)
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Lab invoice"
          placeholderTextColor={JournalTokens.color.muted}
          style={styles.input}
          accessibilityLabel="Bill title"
        />
        <Text allowFontScaling style={styles.label}>
          Provider
        </Text>
        <TextInput
          value={provider}
          onChangeText={setProvider}
          placeholder="Provider or facility name"
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
        <PrimaryButton label={busy ? 'Saving…' : 'Save bill'} onPress={save} />
        <View style={{ height: 10 }} />
        <SecondaryButton label="Cancel" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JournalTokens.color.card },
  scroll: { padding: JournalTokens.spacing.lg, paddingBottom: 40, gap: 8 },
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
