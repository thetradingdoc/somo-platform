import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PhotoAlignPreview } from '@/components/PhotoAlignPreview';
import { JournalTokens } from '@/constants/journalTokens';
import { fetchPriorProgressPhotoUrl } from '@/lib/routine-capture-overlay';
import { uploadRoutineProgressPhoto } from '@/lib/routine-capture';
import { localTodayIso, resolveRoutineDayMode } from '@/lib/routine-day-mode';

const SYMPTOM_OPTIONS = ['Redness', 'Stinging', 'New breakout', 'Dryness', 'Itching'] as const;

export default function RoutineCaptureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; libraryUri?: string }>();
  const entryDate =
    typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : localTodayIso();
  const libraryUri = typeof params.libraryUri === 'string' ? params.libraryUri : null;

  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [ghostUrl, setGhostUrl] = useState<string | null>(null);
  const [ghostPriorDate, setGhostPriorDate] = useState<string | null>(null);
  const [capturedUri, setCapturedUri] = useState<string | null>(libraryUri);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symptomsOpen, setSymptomsOpen] = useState(false);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [alignOpen, setAlignOpen] = useState(false);

  const dayMode = resolveRoutineDayMode(entryDate);
  const allowsPhoto = dayMode.allows_photo;

  useEffect(() => {
    if (!allowsPhoto) {
      setError('This day is read-only. Progress photos can only be added within the last 48 hours.');
    }
  }, [allowsPhoto]);

  useEffect(() => {
    void (async () => {
      try {
        const prior = await fetchPriorProgressPhotoUrl(entryDate);
        setGhostUrl(prior.imageUrl);
        setGhostPriorDate(prior.priorDate);
      } catch {
        setGhostUrl(null);
        setGhostPriorDate(null);
      }
    })();
  }, [entryDate]);

  const finishSuccess = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace({
      pathname: '/(tabs)/today',
      params: { date: entryDate, celebrate: '1' },
    });
  }, [entryDate, router]);

  const uploadPhoto = useCallback(
    async (uri: string) => {
      if (!allowsPhoto) return;
      setBusy(true);
      setError(null);
      try {
        await uploadRoutineProgressPhoto({
          entryDate,
          uri,
          symptomTags: symptoms,
        });
        finishSuccess();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not save photo.');
      } finally {
        setBusy(false);
      }
    },
    [allowsPhoto, entryDate, finishSuccess, symptoms]
  );

  const renderSymptoms = () => (
    <View style={styles.symptomBlock}>
      <Text style={styles.symptomTitle}>Any symptoms today? (optional)</Text>
      <View style={styles.symptomRow}>
        {SYMPTOM_OPTIONS.map((tag) => {
          const on = symptoms.includes(tag);
          return (
            <Pressable
              key={tag}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() =>
                setSymptoms((prev) => (on ? prev.filter((t) => t !== tag) : [...prev, tag]))
              }>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{tag}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const snap = useCallback(async () => {
    if (!camRef.current || busy || !allowsPhoto) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await camRef.current.takePictureAsync({ quality: 0.7 });
      if (!photo?.uri) throw new Error('Camera did not return an image.');
      setCapturedUri(photo.uri);
      await uploadRoutineProgressPhoto({
        entryDate,
        uri: photo.uri,
        symptomTags: symptoms,
      });
      finishSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save photo.');
    } finally {
      setBusy(false);
    }
  }, [allowsPhoto, busy, entryDate, finishSuccess, symptoms]);

  const saveLibraryPhoto = useCallback(async () => {
    if (!libraryUri) return;
    await uploadPhoto(libraryUri);
  }, [libraryUri, uploadPhoto]);

  if (!allowsPhoto) {
    return (
      <SafeAreaView style={styles.center}>
        <Stack.Screen options={{ title: 'Progress photo', headerShown: true }} />
        <Text style={styles.msg}>{error || 'This day cannot be edited.'}</Text>
        <Pressable style={styles.btn} onPress={() => router.back()}>
          <Text style={styles.btnText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (libraryUri && !permission?.granted) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ title: 'Progress photo', headerShown: true }} />
        <View style={styles.libraryWrap}>
          <Image source={{ uri: libraryUri }} style={styles.libraryPreview} resizeMode="cover" />
          {symptomsOpen ? renderSymptoms() : null}
          {error ? <Text style={styles.err}>{error}</Text> : null}
          <Pressable style={styles.btnPrimary} onPress={() => void saveLibraryPhoto()} disabled={busy}>
            <Text style={styles.btnPrimaryText}>{busy ? 'Saving…' : 'Save photo'}</Text>
          </Pressable>
          <Pressable style={styles.btnGhost} onPress={() => setAlignOpen(true)}>
            <Text style={styles.btnGhostText}>Review alignment</Text>
          </Pressable>
          <Pressable style={styles.btnGhost} onPress={() => router.back()}>
            <Text style={styles.btnGhostText}>Cancel</Text>
          </Pressable>
        </View>
        <PhotoAlignPreview
          visible={alignOpen}
          priorUrl={ghostUrl}
          priorDate={ghostPriorDate}
          newUri={libraryUri}
          onRetake={() => router.back()}
          onUsePhoto={() => setAlignOpen(false)}
          onCancel={() => setAlignOpen(false)}
        />
      </SafeAreaView>
    );
  }

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.center}>
        <Stack.Screen options={{ title: 'Progress photo', headerShown: true }} />
        <Text style={styles.msg}>Camera access helps align your progress photos over time.</Text>
        <Pressable style={styles.btnPrimary} onPress={() => void requestPermission()}>
          <Text style={styles.btnPrimaryText}>Allow camera</Text>
        </Pressable>
        <Pressable style={styles.btnGhost} onPress={() => router.back()}>
          <Text style={styles.btnGhostText}>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Progress photo', headerShown: true }} />
      <View style={styles.cameraWrap}>
        <CameraView ref={camRef} style={styles.camera} facing="front" />
        {ghostUrl ? (
          <Image source={{ uri: ghostUrl }} style={styles.ghostOverlay} resizeMode="cover" pointerEvents="none" />
        ) : null}
        <View style={styles.guideFrame} pointerEvents="none" />
        <SafeAreaView edges={['top']} style={styles.hintBar}>
          <Text style={styles.hintText}>
            {ghostUrl && ghostPriorDate
              ? `Line up with your photo from ${ghostPriorDate}`
              : 'Face the camera in good light — this is your baseline'}
          </Text>
        </SafeAreaView>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.controls}>
        <Pressable
          style={styles.symptomToggle}
          onPress={() => setSymptomsOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: symptomsOpen }}>
          <Text style={styles.symptomToggleText}>
            {symptomsOpen ? 'Hide symptoms' : 'Any symptoms today? (optional)'}
          </Text>
        </Pressable>
        {symptomsOpen ? renderSymptoms() : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}
        {busy ? <ActivityIndicator color={JournalTokens.color.accent} style={{ marginBottom: 8 }} /> : null}
        <Pressable
          style={[styles.shutter, busy && styles.shutterDisabled]}
          onPress={() => void snap()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Capture progress photo"
        />
        <Pressable style={styles.btnGhost} onPress={() => router.back()}>
          <Text style={styles.btnGhostText}>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: JournalTokens.color.cream },
  cameraWrap: { flex: 1, position: 'relative' },
  camera: { flex: 1 },
  ghostOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.35,
  },
  guideFrame: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    borderStyle: 'dashed',
    margin: 24,
  },
  hintBar: { position: 'absolute', top: 0, left: 0, right: 0, padding: 16 },
  hintText: { color: '#fff', fontSize: 14, textAlign: 'center', fontWeight: '600' },
  controls: {
    backgroundColor: 'rgba(15,23,42,0.92)',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    alignItems: 'center',
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: JournalTokens.color.accent,
    borderWidth: 4,
    borderColor: '#fff',
    marginBottom: 8,
  },
  shutterDisabled: { opacity: 0.5 },
  symptomToggle: { marginBottom: 8 },
  symptomToggleText: { color: '#e2e8f0', fontSize: 13, fontWeight: '600' },
  symptomBlock: { width: '100%', marginBottom: 8 },
  symptomTitle: { color: '#e2e8f0', fontSize: 12, marginBottom: 6 },
  symptomRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: '#64748b',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipOn: { backgroundColor: JournalTokens.color.accent, borderColor: JournalTokens.color.accent },
  chipText: { color: '#e2e8f0', fontSize: 11 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  err: { color: '#fca5a5', fontSize: 12, marginBottom: 6, textAlign: 'center' },
  btnPrimary: {
    backgroundColor: JournalTokens.color.accent,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    marginTop: 8,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  btnGhost: { paddingVertical: 10 },
  btnGhostText: { color: '#94a3b8', fontWeight: '600' },
  btn: { marginTop: 12, padding: 12 },
  btnText: { color: JournalTokens.color.accent, fontWeight: '600' },
  msg: { color: JournalTokens.color.ink, textAlign: 'center', marginBottom: 16 },
  libraryWrap: { flex: 1, padding: 16, backgroundColor: JournalTokens.color.cream },
  libraryPreview: { width: '100%', aspectRatio: 3 / 4, borderRadius: 12, backgroundColor: '#e2e8f0' },
});
