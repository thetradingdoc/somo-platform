import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { JournalTokens } from '@/constants/journalTokens';

export type RoutineStep = {
  product_name?: string;
  usage_time?: string;
  goal?: string;
};

type Props = {
  steps: RoutineStep[];
  alwaysExpanded?: boolean;
};

export function RoutineStepsHero({ steps, alwaysExpanded = true }: Props) {
  const am = steps.filter((s) => String(s.usage_time || '').toLowerCase() === 'am');
  const pm = steps.filter((s) => String(s.usage_time || '').toLowerCase() === 'pm');
  const other = steps.filter((s) => {
    const t = String(s.usage_time || '').toLowerCase();
    return t !== 'am' && t !== 'pm';
  });

  if (!steps.length) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Today&apos;s routine</Text>
      {alwaysExpanded ? (
        <>
          {am.length ? <StepGroup label="Morning" items={am} /> : null}
          {pm.length ? <StepGroup label="Evening" items={pm} /> : null}
          {other.length ? <StepGroup label="Anytime" items={other} /> : null}
        </>
      ) : (
        <Text style={styles.meta}>
          AM · {am.length} · PM · {pm.length}
        </Text>
      )}
    </View>
  );
}

function StepGroup({ label, items }: { label: string; items: RoutineStep[] }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      {items.map((row, idx) => (
        <View key={`${label}-${row.product_name}-${idx}`} style={styles.row}>
          <Text style={styles.product}>{row.product_name || 'Step'}</Text>
          {row.goal ? <Text style={styles.goal}>{row.goal}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.md,
    gap: 10,
  },
  title: {
    fontFamily: JournalTokens.font.body,
    fontWeight: '700',
    fontSize: 17,
    color: JournalTokens.color.ink,
  },
  meta: { color: JournalTokens.color.muted, fontSize: 14 },
  group: { gap: 6 },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: JournalTokens.color.muted,
  },
  row: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: JournalTokens.color.line,
  },
  product: { fontSize: 15, fontWeight: '600', color: JournalTokens.color.ink },
  goal: { fontSize: 12, color: JournalTokens.color.muted, marginTop: 2 },
});
