import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { JournalTokens } from '@/constants/journalTokens';

type Props = {
  visible: boolean;
  priorUrl: string | null;
  priorDate: string | null;
  newUri: string;
  onRetake: () => void;
  onUsePhoto: () => void;
  onCancel: () => void;
};

/** Post-capture alignment check: ghost still + new shot before symptom step. */
export function PhotoAlignPreview({
  visible,
  priorUrl,
  priorDate,
  newUri,
  onRetake,
  onUsePhoto,
  onCancel,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Check alignment</Text>
          <Text style={styles.sub}>
            {priorUrl && priorDate
              ? `Compare with your photo from ${priorDate}. Retake if angle or lighting looks off.`
              : 'This is your baseline — use a well-lit spot and face the camera straight on.'}
          </Text>
          <View style={styles.grid}>
            <View style={styles.col}>
              <Text style={styles.colLabel}>{priorUrl ? 'Last photo' : 'Guide'}</Text>
              {priorUrl ? (
                <Image source={{ uri: priorUrl }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={styles.thumbEmpty}>
                  <Text style={styles.emptyText}>First photo</Text>
                </View>
              )}
            </View>
            <View style={styles.col}>
              <Text style={styles.colLabel}>New</Text>
              <Image source={{ uri: newUri }} style={styles.thumb} resizeMode="cover" />
            </View>
          </View>
          <Pressable style={styles.primary} onPress={onUsePhoto} accessibilityRole="button">
            <Text style={styles.primaryText}>Use this photo</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={onRetake} accessibilityRole="button">
            <Text style={styles.secondaryText}>Retake</Text>
          </Pressable>
          <Pressable style={styles.tertiary} onPress={onCancel} accessibilityRole="button">
            <Text style={styles.tertiaryText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.lg,
    padding: 16,
    gap: 10,
  },
  title: { fontWeight: '700', fontSize: 17, color: JournalTokens.color.ink },
  sub: { fontSize: 13, color: JournalTokens.color.muted, lineHeight: 18 },
  grid: { flexDirection: 'row', gap: 10 },
  col: { flex: 1, gap: 6 },
  colLabel: { fontSize: 11, fontWeight: '600', color: JournalTokens.color.muted },
  thumb: { width: '100%', aspectRatio: 3 / 4, borderRadius: 8, backgroundColor: '#e2e8f0' },
  thumbEmpty: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { fontSize: 12, color: JournalTokens.color.muted },
  primary: {
    backgroundColor: JournalTokens.color.accent,
    borderRadius: JournalTokens.radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  secondaryText: { color: JournalTokens.color.accent, fontWeight: '600' },
  tertiary: { paddingVertical: 6, alignItems: 'center' },
  tertiaryText: { color: JournalTokens.color.muted, fontSize: 13 },
});
