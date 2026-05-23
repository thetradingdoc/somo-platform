import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PhotoGhostOverlay } from '@/components/PhotoGhostOverlay';
import { PrimaryButton, SecondaryButton } from '@/components/billing-ui';
import { JournalTokens } from '@/constants/journalTokens';
import { TimelineTokens } from '@/constants/timelineTokens';
import { patientGet } from '@/lib/patient-api';
import type { SkinReportPayload } from '@/lib/routine-capture';
import { uploadRoutineProgressPhoto } from '@/lib/routine-capture';
import { fetchPriorProgressPhotoUrl } from '@/lib/routine-capture-overlay';
import { localTodayIso, resolveRoutineDayMode, weekdayLabel, type RoutineDayMode } from '@/lib/routine-day-mode';

const SYMPTOM_OPTIONS = ['Redness', 'Stinging', 'New breakout', 'Dryness', 'Itching'] as const;

type PhaseItem = {
  product_name?: string;
  usage_time?: string;
  goal?: string;
};

export default function TodayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; photo?: string }>();
  const selectedDate =
    typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : localTodayIso();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string>('Your routine');
  const [hasTemplate, setHasTemplate] = useState(false);
  const [completionScore, setCompletionScore] = useState<number | null>(null);
  const [phaseItems, setPhaseItems] = useState<PhaseItem[]>([]);
  const [programWeek, setProgramWeek] = useState(1);
  const [totalWeeks, setTotalWeeks] = useState(12);
  const [phaseLabel, setPhaseLabel] = useState<string | null>(null);
  const [phaseExpect, setPhaseExpect] = useState<string | null>(null);
  const [phaseFocus, setPhaseFocus] = useState<string | null>(null);
  const [phaseNotes, setPhaseNotes] = useState<string | null>(null);
  const [phaseNotesOpen, setPhaseNotesOpen] = useState(false);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [redFlags, setRedFlags] = useState<string[]>([]);
  const [assistantSummary, setAssistantSummary] = useState<string | null>(null);
  const [frozenSkinReport, setFrozenSkinReport] = useState<SkinReportPayload | null>(null);
  const [dayMode, setDayMode] = useState<RoutineDayMode>('today');
  const [allowsPhoto, setAllowsPhoto] = useState(true);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [ghostVisible, setGhostVisible] = useState(false);
  const [ghostUrl, setGhostUrl] = useState<string | null>(null);
  const [ghostPriorDate, setGhostPriorDate] = useState<string | null>(null);
  const [pendingSymptoms, setPendingSymptoms] = useState<string[]>([]);
  const [showSymptomPicker, setShowSymptomPicker] = useState(false);
  const [layeringWarning, setLayeringWarning] = useState<string | null>(null);
  const photoTriggeredRef = useRef(false);
  const pendingPhotoUriRef = useRef<string | null>(null);

  const clientDayMode = resolveRoutineDayMode(selectedDate);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [templateRes, dailyRes, phaseRes] = await Promise.all([
        patientGet('/api/patient/routine/template'),
        patientGet(`/api/patient/routine/daily?date=${selectedDate}`),
        patientGet(`/api/patient/routine/phase?date=${selectedDate}`).catch(() => null),
      ]);
      setHasTemplate(Boolean(templateRes?.has_template));
      setTemplateName(templateRes?.template?.name || 'Care program');
      const score = dailyRes?.daily_entry?.completion_score;
      setCompletionScore(Number.isFinite(Number(score)) ? Number(score) : null);

      const apiMode = (dailyRes?.day_mode || phaseRes?.day_mode || clientDayMode.mode) as RoutineDayMode;
      setDayMode(apiMode);
      setAllowsPhoto(
        Boolean(dailyRes?.allows_photo ?? phaseRes?.allows_photo ?? clientDayMode.allows_photo)
      );

      const parsedReport = dailyRes?.daily_entry?.skin_report_parsed as SkinReportPayload | null;
      setFrozenSkinReport(parsedReport || null);
      if (parsedReport?.assistant_summary && apiMode === 'historical') {
        setAssistantSummary(parsedReport.assistant_summary);
        if (parsedReport.program_week) setProgramWeek(Number(parsedReport.program_week));
        if (parsedReport.phase_label) setPhaseLabel(parsedReport.phase_label);
      } else {
        setAssistantSummary(null);
      }

      if (phaseRes?.has_template && phaseRes?.phase) {
        if (apiMode !== 'historical' || !parsedReport?.assistant_summary) {
          setProgramWeek(Number(phaseRes.phase.program_week) || 1);
          setPhaseLabel(phaseRes.phase.label || null);
          setPhaseExpect(phaseRes.phase.expect || null);
          setPhaseFocus(phaseRes.phase.focus || null);
        }
        setPhaseNotes(phaseRes.phase.notes || null);
        setTotalWeeks(Number(phaseRes.phase.total_weeks) || 12);
        setRedFlags(Array.isArray(phaseRes.phase.red_flags) ? phaseRes.phase.red_flags : []);
        const steps =
          apiMode === 'historical' && Array.isArray(parsedReport?.frozen_steps) && parsedReport.frozen_steps.length
            ? parsedReport.frozen_steps
            : Array.isArray(phaseRes.items)
              ? phaseRes.items
              : [];
        setPhaseItems(steps);
      } else {
        const fallback = Array.isArray(templateRes?.template?.items) ? templateRes.template.items : [];
        setPhaseItems(
          apiMode === 'historical' && Array.isArray(parsedReport?.frozen_steps) && parsedReport.frozen_steps.length
            ? parsedReport.frozen_steps
            : fallback
        );
        if (apiMode !== 'historical') {
          setPhaseExpect(null);
          setPhaseFocus(null);
        }
        setPhaseNotes(null);
        setRedFlags([]);
      }
      if (templateRes?.has_template) {
        try {
          const layer = await patientGet('/api/patient/routine/layering-check');
          const conflicts = Array.isArray(layer?.conflicts) ? layer.conflicts : [];
          if (conflicts.length) {
            setLayeringWarning(conflicts[0]?.notes || 'Check layering before combining actives.');
          } else {
            setLayeringWarning(null);
          }
        } catch {
          setLayeringWarning(null);
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Unable to load today.');
      setHasTemplate(false);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, clientDayMode.mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProgressPhoto = useCallback(
    async (
      uri: string,
      fileName = `progress-${Date.now()}.jpg`,
      mimeType = 'image/jpeg',
      symptoms: string[] = []
    ) => {
      if (!allowsPhoto) {
        setError('This day is read-only. Progress photos can only be added within the last 48 hours.');
        return;
      }
      setPhotoBusy(true);
      try {
        const result = await uploadRoutineProgressPhoto({
          entryDate: selectedDate,
          uri,
          fileName,
          mimeType,
          symptomTags: symptoms,
        });
        if (result.assistant_summary) setAssistantSummary(result.assistant_summary);
        setShowSymptomPicker(false);
        setPendingSymptoms([]);
        await load();
      } catch (e: any) {
        setError(e?.message || 'Could not save photo.');
      } finally {
        setPhotoBusy(false);
      }
    },
    [allowsPhoto, load, selectedDate]
  );

  const openCameraWithGhost = useCallback(async () => {
    if (photoBusy || !allowsPhoto) return;
    const prior = await fetchPriorProgressPhotoUrl(selectedDate);
    setGhostUrl(prior.imageUrl);
    setGhostPriorDate(prior.priorDate);
    setGhostVisible(true);
  }, [allowsPhoto, photoBusy, selectedDate]);

  const continueFromGhost = useCallback(async () => {
    setGhostVisible(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Camera permission is required for progress photos.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (shot.canceled || !shot.assets?.[0]?.uri) return;
    setShowSymptomPicker(true);
    setPendingSymptoms([]);
    await saveProgressPhoto(shot.assets[0].uri, undefined, undefined, []);
  }, [saveProgressPhoto]);

  const pickProgressPhoto = useCallback(async () => {
    if (photoBusy || !allowsPhoto) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo library access is required to upload progress photos.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    await saveProgressPhoto(picked.assets[0].uri);
  }, [allowsPhoto, photoBusy, saveProgressPhoto]);

  useEffect(() => {
    if (params.photo !== '1' || photoTriggeredRef.current || loading || !hasTemplate || !allowsPhoto) return;
    photoTriggeredRef.current = true;
    void openCameraWithGhost();
  }, [params.photo, loading, hasTemplate, allowsPhoto, openCameraWithGhost]);

  const weekKicker = hasTemplate
    ? `Week ${programWeek} of ${totalWeeks}${phaseLabel ? ` · ${phaseLabel}` : ''}`
    : null;

  const phaseBody =
    assistantSummary ||
    phaseExpect ||
    phaseFocus ||
    (hasTemplate && dayMode !== 'historical'
      ? 'Add a progress photo when you are ready — we track your week for you.'
      : hasTemplate && dayMode === 'historical'
        ? 'This is a saved snapshot from when you logged this day.'
        : null);

  const loggedForDay = completionScore != null && completionScore >= 100;
  const amCount = phaseItems.filter((i) => String(i.usage_time || '').toLowerCase() === 'am').length;
  const pmCount = phaseItems.filter((i) => String(i.usage_time || '').toLowerCase() === 'pm').length;

  const screenTitle =
    dayMode === 'today' ? 'Today' : dayMode === 'backfill' ? 'Backfill' : 'History';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
        <Text allowFontScaling style={styles.title}>
          {screenTitle}
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          {selectedDate}
        </Text>

        {dayMode === 'historical' ? (
          <View style={styles.historyBanner}>
            <Text style={styles.historyBannerText}>Viewing history — this day is read-only.</Text>
          </View>
        ) : null}
        {dayMode === 'backfill' ? (
          <View style={styles.backfillBanner}>
            <Text style={styles.backfillBannerText}>
              Logging for {weekdayLabel(selectedDate)} — add your progress photo for this day.
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!hasTemplate && !error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Choose your routine</Text>
            <Text style={styles.emptyBody}>
              Pick one of five guided templates. Your daily check-in is a quick photo — we track your progress for you.
            </Text>
            <PrimaryButton label="Choose a routine" onPress={() => router.push('/routine/pick')} />
          </View>
        ) : null}

        {hasTemplate && weekKicker && phaseBody ? (
          <View style={styles.phaseCard}>
            <Text style={styles.phaseKicker}>{weekKicker}</Text>
            <Text style={styles.phaseBody}>{phaseBody}</Text>
            {phaseNotes && dayMode !== 'historical' ? (
              <Pressable
                onPress={() => setPhaseNotesOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: phaseNotesOpen }}>
                <Text style={styles.phaseExpand}>
                  {phaseNotesOpen ? 'Hide phase details' : 'More about this phase'}
                </Text>
              </Pressable>
            ) : null}
            {phaseNotesOpen && phaseNotes ? (
              <Text style={styles.phaseNotes}>{phaseNotes}</Text>
            ) : null}
          </View>
        ) : null}

        {hasTemplate && allowsPhoto ? (
          <View style={styles.photoActions}>
            {loggedForDay ? (
              <Text style={styles.loggedDone}>
                {dayMode === 'today' ? 'Logged for today ✓' : `Logged for ${selectedDate} ✓`}
              </Text>
            ) : (
              <>
                <PrimaryButton
                  label={photoBusy ? 'Saving…' : dayMode === 'today' ? "Add today's photo" : 'Add progress photo'}
                  onPress={() => void takeProgressPhoto()}
                />
                <View style={{ height: 10 }} />
                <SecondaryButton label="Upload from library" onPress={() => void pickProgressPhoto()} />
              </>
            )}
          </View>
        ) : null}

        {layeringWarning && stepsExpanded ? (
          <View style={styles.layerCard}>
            <Text style={styles.layerTitle}>Layering note</Text>
            <Text style={styles.layerBody}>{layeringWarning}</Text>
          </View>
        ) : null}

        {showSymptomPicker && allowsPhoto ? (
          <View style={styles.symptomCard}>
            <Text style={styles.symptomTitle}>Any symptoms today? (optional)</Text>
            <View style={styles.symptomRow}>
              {SYMPTOM_OPTIONS.map((tag) => {
                const on = pendingSymptoms.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    style={[styles.symptomChip, on && styles.symptomChipOn]}
                    onPress={() =>
                      setPendingSymptoms((prev) =>
                        on ? prev.filter((t) => t !== tag) : [...prev, tag]
                      )
                    }>
                    <Text style={[styles.symptomChipText, on && styles.symptomChipTextOn]}>{tag}</Text>
                  </Pressable>
                );
              })}
            </View>
            <PrimaryButton label="Save photo" onPress={() => void confirmPhotoWithSymptoms()} />
          </View>
        ) : null}

        {hasTemplate && phaseItems.length > 0 ? (
          <View style={styles.stepsSection}>
            <Pressable
              style={styles.stepsToggle}
              onPress={() => setStepsExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: stepsExpanded }}>
              <Text style={styles.stepsToggleText}>
                AM · {amCount} step{amCount === 1 ? '' : 's'} · PM · {pmCount} step{pmCount === 1 ? '' : 's'}
                {dayMode === 'historical' && frozenSkinReport?.frozen_steps?.length ? ' · saved routine' : ''}
              </Text>
              <Text style={styles.stepsChevron}>{stepsExpanded ? '▴' : '▾'}</Text>
            </Pressable>
            {stepsExpanded
              ? phaseItems.map((row, idx) => (
                  <View key={`${row.product_name}-${idx}`} style={styles.row}>
                    <Text allowFontScaling style={styles.slot}>
                      {String(row.usage_time || 'any').toUpperCase()}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text allowFontScaling style={styles.step}>
                        {row.product_name || 'Step'}
                      </Text>
                      {row.goal ? <Text style={styles.goal}>{row.goal}</Text> : null}
                    </View>
                  </View>
                ))
              : null}
          </View>
        ) : null}

        {hasTemplate && redFlags.length > 0 && dayMode !== 'historical' ? (
          <View style={styles.redCard}>
            <Text style={styles.redTitle}>When to seek help</Text>
            {redFlags.slice(0, 3).map((f) => (
              <Text key={f} style={styles.redBody}>
                • {f}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JournalTokens.color.cream },
  content: { padding: JournalTokens.spacing.lg, gap: JournalTokens.spacing.sm },
  title: { fontFamily: JournalTokens.font.display, fontSize: 30, color: JournalTokens.color.ink },
  subtitle: { fontFamily: JournalTokens.font.body, color: JournalTokens.color.muted, marginBottom: JournalTokens.spacing.md },
  historyBanner: {
    backgroundColor: TimelineTokens.historyBannerBg,
    borderRadius: JournalTokens.radius.md,
    padding: JournalTokens.spacing.sm,
    marginBottom: 4,
  },
  historyBannerText: { color: TimelineTokens.historyBannerFg, fontSize: 13, fontWeight: '600' },
  backfillBanner: {
    backgroundColor: TimelineTokens.backfillBannerBg,
    borderRadius: JournalTokens.radius.md,
    padding: JournalTokens.spacing.sm,
    marginBottom: 4,
  },
  backfillBannerText: { color: TimelineTokens.backfillBannerFg, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  phaseCard: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    borderLeftWidth: 3,
    borderLeftColor: JournalTokens.color.accent,
    padding: JournalTokens.spacing.md,
    gap: 8,
  },
  phaseKicker: { fontWeight: '700', color: JournalTokens.color.ink, fontSize: 15 },
  phaseBody: { color: JournalTokens.color.muted, lineHeight: 22, fontFamily: JournalTokens.font.body, fontSize: 15 },
  phaseExpand: { color: JournalTokens.color.accent, fontWeight: '600', fontSize: 13, marginTop: 4 },
  phaseNotes: { color: JournalTokens.color.muted, fontSize: 13, lineHeight: 20, marginTop: 4 },
  photoActions: { marginTop: 4, marginBottom: 8 },
  loggedDone: {
    color: JournalTokens.color.success,
    fontWeight: '700',
    fontSize: 16,
    textAlign: 'center',
    paddingVertical: 14,
  },
  emptyCard: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.md,
    gap: 10,
  },
  emptyTitle: { fontWeight: '700', color: JournalTokens.color.ink, fontSize: 17 },
  emptyBody: { color: JournalTokens.color.muted, lineHeight: 20, fontFamily: JournalTokens.font.body },
  redCard: {
    backgroundColor: '#fef2f2',
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: JournalTokens.spacing.md,
  },
  redTitle: { fontWeight: '700', color: '#991b1b', marginBottom: 4 },
  redBody: { color: '#991b1b', fontSize: 13 },
  stepsSection: { marginTop: 8, gap: 8 },
  stepsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    paddingHorizontal: JournalTokens.spacing.md,
    paddingVertical: 12,
  },
  stepsToggleText: {
    fontFamily: JournalTokens.font.body,
    fontSize: 14,
    fontWeight: '600',
    color: JournalTokens.color.ink,
  },
  stepsChevron: { fontSize: 14, color: JournalTokens.color.muted },
  row: {
    minHeight: JournalTokens.minTap,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    backgroundColor: JournalTokens.color.card,
    paddingHorizontal: JournalTokens.spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: JournalTokens.spacing.sm,
  },
  slot: { width: 34, fontFamily: JournalTokens.font.body, color: JournalTokens.color.muted, fontWeight: '700' },
  step: { fontFamily: JournalTokens.font.body, color: JournalTokens.color.ink },
  goal: { fontSize: 12, color: JournalTokens.color.muted, marginTop: 2 },
  error: { color: '#b91c1c', fontSize: 13 },
  layerCard: {
    backgroundColor: '#fff7ed',
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: '#fed7aa',
    padding: 12,
    gap: 4,
  },
  layerTitle: { fontWeight: '700', color: '#9a3412', fontSize: 13 },
  layerBody: { color: '#9a3412', fontSize: 12, lineHeight: 18 },
  symptomCard: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: 12,
    gap: 8,
  },
  symptomTitle: { fontWeight: '600', color: JournalTokens.color.ink, fontSize: 14 },
  symptomRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  symptomChip: {
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  symptomChipOn: { backgroundColor: JournalTokens.color.accent, borderColor: JournalTokens.color.accent },
  symptomChipText: { fontSize: 12, color: JournalTokens.color.ink },
  symptomChipTextOn: { color: '#fff', fontWeight: '600' },
});
