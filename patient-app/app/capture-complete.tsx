import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton } from '@/components/billing-ui';
import { JournalTokens } from '@/constants/journalTokens';

export default function CaptureCompleteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string | string[] }>();
  const kind = Array.isArray(params.kind) ? params.kind[0] : params.kind;

  const subtitle =
    kind === 'manual_payment'
      ? 'Payment recorded.'
      : kind === 'manual_bill'
        ? 'Bill recorded.'
        : 'Your document is saved and linked on the timeline.';

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ title: 'Saved' }} />
      <View style={styles.block}>
        <Text allowFontScaling style={styles.title}>
          You’re all set
        </Text>
        <Text allowFontScaling style={styles.sub}>
          {subtitle}
        </Text>
        <PrimaryButton label="Open timeline" onPress={() => router.replace('/(tabs)/timeline')} />
        <View style={{ height: 12 }} />
        <SecondaryButton label="Close" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JournalTokens.color.card },
  block: { flex: 1, padding: JournalTokens.spacing.lg, justifyContent: 'center', gap: JournalTokens.spacing.md },
  title: {
    fontFamily: JournalTokens.font.display,
    fontSize: 28,
    color: JournalTokens.color.ink,
  },
  sub: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.muted,
    lineHeight: 22,
    marginBottom: JournalTokens.spacing.md,
  },
});
