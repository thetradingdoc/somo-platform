import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/billing-feedback';
import { PrimaryButton, SecondaryButton } from '@/components/billing-ui';
import { JournalTokens } from '@/constants/journalTokens';
import { uploadBillingDocumentFile } from '@/lib/billing-capture';

export default function CaptureScanScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

  const snap = async () => {
    if (!camRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await camRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) throw new Error('Camera did not return an image.');
      const doc = await uploadBillingDocumentFile({
        uri: photo.uri,
        fileName: `scan-${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        sourceType: 'scan',
      });
      router.replace({ pathname: '/capture-review', params: { documentId: doc.id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.center}>
        <Stack.Screen options={{ title: 'Scan receipt' }} />
        <Text allowFontScaling style={styles.body}>
          Camera access is needed to scan receipts.
        </Text>
        <PrimaryButton label="Allow camera" onPress={() => requestPermission()} />
        <View style={{ height: 12 }} />
        <SecondaryButton label="Close" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Scan receipt' }} />
      <CameraView ref={camRef} style={styles.camera} facing="back" />
      <SafeAreaView edges={['bottom']} style={styles.bar}>
        {busy ? <ActivityIndicator color="#fff" style={{ marginBottom: 12 }} /> : null}
        <Pressable
          style={[styles.shutter, busy && styles.shutterDisabled]}
          onPress={snap}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Capture photo"
        />
        <SecondaryButton label="Cancel" onPress={() => router.back()} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: JournalTokens.spacing.lg,
    gap: JournalTokens.spacing.md,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  shutterDisabled: { opacity: 0.5 },
  center: {
    flex: 1,
    padding: JournalTokens.spacing.lg,
    justifyContent: 'center',
    gap: JournalTokens.spacing.md,
    backgroundColor: JournalTokens.color.card,
  },
  body: {
    fontFamily: JournalTokens.font.body,
    fontSize: 16,
    color: JournalTokens.color.ink,
    marginBottom: JournalTokens.spacing.sm,
  },
});
