import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JournalTokens } from '@/constants/journalTokens';

export default function ScanEntryScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ title: 'Quick Capture', presentation: 'modal' }} />
      <View style={styles.sheet}>
        <Text allowFontScaling style={styles.title}>Quick capture</Text>
        <Text allowFontScaling style={styles.subtitle}>
          Add billing information quickly from camera, files, or manual entry.
        </Text>
        <Pressable
          style={styles.cta}
          onPress={() => router.push('/capture-scan')}
          accessibilityRole="button"
          accessibilityLabel="Scan receipt">
          <Text allowFontScaling style={styles.ctaText}>Scan receipt</Text>
        </Pressable>
        <Pressable
          style={styles.cta}
          onPress={() => router.push('/capture-upload')}
          accessibilityRole="button"
          accessibilityLabel="Upload EOB or PDF">
          <Text allowFontScaling style={styles.ctaText}>Upload EOB/PDF</Text>
        </Pressable>
        <Pressable
          style={styles.cta}
          onPress={() => router.push('/capture-manual-bill')}
          accessibilityRole="button"
          accessibilityLabel="Add bill manually">
          <Text allowFontScaling style={styles.ctaText}>Add bill manually</Text>
        </Pressable>
        <Pressable
          style={styles.cta}
          onPress={() => router.push('/capture-manual-payment')}
          accessibilityRole="button"
          accessibilityLabel="Add payment manually">
          <Text allowFontScaling style={styles.ctaText}>Add payment manually</Text>
        </Pressable>
        <Pressable style={[styles.cta, styles.secondary]} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close scan entry">
          <Text allowFontScaling style={styles.secondaryText}>Close</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: JournalTokens.color.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: JournalTokens.spacing.lg,
    gap: JournalTokens.spacing.md,
  },
  title: {
    fontFamily: JournalTokens.font.display,
    fontSize: 28,
    color: JournalTokens.color.ink,
  },
  subtitle: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.muted,
    lineHeight: 20,
  },
  cta: {
    minHeight: JournalTokens.minTap,
    borderRadius: JournalTokens.radius.md,
    backgroundColor: JournalTokens.color.accent,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: JournalTokens.spacing.md,
  },
  ctaText: {
    color: JournalTokens.color.ink,
    fontFamily: JournalTokens.font.body,
    fontWeight: '700',
  },
  secondary: {
    backgroundColor: JournalTokens.color.cream,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
  },
  secondaryText: {
    color: JournalTokens.color.muted,
    fontFamily: JournalTokens.font.body,
    fontWeight: '700',
  },
});

