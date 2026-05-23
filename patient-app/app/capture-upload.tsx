import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/billing-feedback';
import { PrimaryButton, SecondaryButton } from '@/components/billing-ui';
import { JournalTokens } from '@/constants/journalTokens';
import { uploadBillingDocumentFile } from '@/lib/billing-capture';

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function guessMime(name: string, declared?: string | null) {
  const d = (declared || '').toLowerCase();
  if (ALLOWED_MIME.has(d)) return d;
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export default function CaptureUploadScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const uploadPicked = async (picked: { uri: string; name: string; mime: string } | null) => {
    if (!picked) return;
    const doc = await uploadBillingDocumentFile({
      uri: picked.uri,
      fileName: picked.name,
      mimeType: picked.mime,
      sourceType: 'upload',
    });
    router.replace({ pathname: '/capture-review', params: { documentId: doc.id } });
  };

  const pickDocument = async () => {
    setBusy(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const name = a.name || 'document';
      await uploadPicked({ uri: a.uri, name, mime: guessMime(name, a.mimeType) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const pickPhotoLibrary = async () => {
    setBusy(true);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showToast('Photo library access denied', 'error');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const name = a.fileName || `photo-${Date.now()}.jpg`;
      await uploadPicked({ uri: a.uri, name, mime: guessMime(name, a.mimeType || 'image/jpeg') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ title: 'Upload EOB/PDF' }} />
      <Text allowFontScaling style={styles.title}>
        Upload a document
      </Text>
      <Text allowFontScaling style={styles.sub}>
        PDF or a clear photo of your EOB or receipt (JPEG, PNG, WebP).
      </Text>
      {busy ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null}
      <PrimaryButton label="Choose file (PDF or image)" onPress={pickDocument} />
      <View style={{ height: 10 }} />
      <PrimaryButton label="Pick from photo library" onPress={pickPhotoLibrary} />
      <View style={{ height: 10 }} />
      <SecondaryButton label="Close" onPress={() => router.back()} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: JournalTokens.spacing.lg,
    backgroundColor: JournalTokens.color.card,
    gap: JournalTokens.spacing.sm,
  },
  title: {
    fontFamily: JournalTokens.font.display,
    fontSize: 26,
    color: JournalTokens.color.ink,
  },
  sub: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.muted,
    lineHeight: 20,
    marginBottom: JournalTokens.spacing.md,
  },
});
