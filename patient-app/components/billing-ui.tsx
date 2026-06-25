import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { JournalTokens } from '@/constants/journalTokens';
import { BillingTheme } from '@/constants/billingTheme';

type BtnProps = { label: string; onPress?: () => void };

export function PrimaryButton({ label, onPress }: BtnProps) {
  return (
    <Pressable style={styles.primary} onPress={onPress} accessibilityRole="button">
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress }: BtnProps) {
  return (
    <Pressable style={styles.secondary} onPress={onPress} accessibilityRole="button">
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

export function BillingBadge({ label, tone }: { label: string; tone?: string }) {
  const bg =
    tone === 'success' ? '#EAF3DE' : tone === 'warning' ? '#FAEEDA' : tone === 'error' ? '#FCEBEB' : '#E6F1FB';
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export function StatusDot({ color, state }: { color?: string; state?: 'completed' | 'pending' | 'default' }) {
  const resolved =
    color ??
    (state === 'completed' ? '#3D8A5A' : state === 'pending' ? '#BA7517' : '#94a3b8');
  return <View style={[styles.dot, { backgroundColor: resolved }]} />;
}

const styles = StyleSheet.create({
  primary: {
    backgroundColor: BillingTheme.button.primaryBg,
    borderRadius: JournalTokens.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: BillingTheme.button.primaryText, fontWeight: '700', fontSize: 16 },
  secondary: {
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    borderRadius: JournalTokens.radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: JournalTokens.color.card,
  },
  secondaryText: { color: JournalTokens.color.ink, fontWeight: '600' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '600', color: JournalTokens.color.ink },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
