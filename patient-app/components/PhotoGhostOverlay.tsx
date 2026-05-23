import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { JournalTokens } from '@/constants/journalTokens';

type Props = {
  visible: boolean;
  imageUrl: string | null;
  priorDate: string | null;
  onContinue: () => void;
  onCancel: () => void;
};

export function PhotoGhostOverlay({ visible, imageUrl, priorDate, onContinue, onCancel }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Align with your last photo</Text>
          <Text style={styles.sub}>
            {imageUrl && priorDate
              ? `Use the faint guide from ${priorDate} so progress photos line up.`
              : 'Take your baseline photo — we will use it to align future shots.'}
          </Text>
          {imageUrl ? (
            <View style={styles.frame}>
              <Image source={{ uri: imageUrl }} style={styles.ghost} resizeMode="cover" />
              <View style={styles.frameOverlay} />
            </View>
          ) : (
            <View style={styles.emptyFrame}>
              <Text style={styles.emptyText}>No prior photo yet</Text>
            </View>
          )}
          <Pressable style={styles.primary} onPress={onContinue} accessibilityRole="button">
            <Text style={styles.primaryText}>Continue to camera</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={onCancel} accessibilityRole="button">
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    padding: 16,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: JournalTokens.color.ink },
  sub: { fontSize: 14, color: JournalTokens.color.muted, lineHeight: 20 },
  frame: {
    height: 280,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
  },
  ghost: { ...StyleSheet.absoluteFillObject, opacity: 0.35 },
  frameOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    borderStyle: 'dashed',
  },
  emptyFrame: {
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { color: JournalTokens.color.muted, fontSize: 13 },
  primary: {
    backgroundColor: JournalTokens.color.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondary: { paddingVertical: 8, alignItems: 'center' },
  secondaryText: { color: JournalTokens.color.muted, fontWeight: '600' },
});
