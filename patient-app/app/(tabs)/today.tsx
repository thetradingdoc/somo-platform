import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RoutineStepsHero } from '@/components/RoutineStepsHero';
import { PrimaryButton, SecondaryButton } from '@/components/billing-ui';
import { JournalTokens } from '@/constants/journalTokens';
import { TimelineTokens } from '@/constants/timelineTokens';
import { patientGet } from '@/lib/patient-api';
import type { SkinReportPayload } from '@/lib/routine-capture';
import { localTodayIso, resolveRoutineDayMode, weekdayLabel, type RoutineDayMode } from '@/lib/routine-day-mode';
import {
  celebrateBannerCopy,
  layeringUnavailableCopy,
  todayScreenTitle,
} from '@/lib/routine-copy';

type PhaseItem = {
  product_name?: string;
  usage_time?: string;
  goal?: string;
};

export default function TodayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; photo?: string; celebrate?: string }>();
  const selectedDate =
    typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : localTodayIso();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  const [redFlags, setRedFlags] = useState<string[]>([]);
  const [assistantSummary, setAssistantSummary] = useState<string | null>(null);
  const [frozenSkinReport, setFrozenSkinReport] = useState<SkinReportPayload | null>(null);
  const [dayMode, setDayMode] = useState<RoutineDayMode>('today');
  const [allowsPhoto, setAllowsPhoto] = useState(true);
  const [layeringWarning, setLayeringWarning] = useState<string | null>(null);
  const [showCelebrate, setShowCelebrate] = useState(params.celebrate === '1');
  const photoTriggeredRef = useRef(false);

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
      const score = dailyRes?.daily_entry?.completion_score;
      const scoreNum = Number.isFinite(Number(score)) ? Number(score) : null;
      setCompletionScore(scoreNum);

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
          if (layer?.graph_unavailable || layer?.overall === 'unknown') {
            setLayeringWarning(layeringUnavailableCopy());
          } else {
            const conflicts = Array.isArray(layer?.conflicts) ? layer.conflicts : [];
            if (conflicts.length) {
              setLayeringWarning(conflicts[0]?.notes || 'Check layering before combining actives.');
            } else if (layer?.overall && layer.overall !== 'safe') {
              setLayeringWarning('Your routine may need spacing between actives.');
            } else {
              setLayeringWarning(null);
            }
          }
        } catch {
          setLayeringWarning(null);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unable to load today.');
      setHasTemplate(false);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, clientDayMode.mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCapture = useCallback(() => {
    if (!allowsPhoto) return;
    router.push({
      pathname: '/routine/capture',
      params: { date: selectedDate },
    });
  }, [allowsPhoto, router, selectedDate]);

  const pickFromLibrary = useCallback(async () => {
    if (!allowsPhoto) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo library access is required.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    router.push({
      pathname: '/routine/capture',
      params: { date: selectedDate, libraryUri: picked.assets[0].uri },
    });
  }, [allowsPhoto, router, selectedDate]);

  useEffect(() => {
    if (params.photo !== '1' || photoTriggeredRef.current || loading || !hasTemplate || !allowsPhoto) return;
    photoTriggeredRef.current = true;
    openCapture();
  }, [params.photo, loading, hasTemplate, allowsPhoto, openCapture]);

  useEffect(() => {
    if (params.celebrate === '1') setShowCelebrate(true);
  }, [params.celebrate]);

  const weekKicker = hasTemplate
    ? `Week ${programWeek} of ${totalWeeks}${phaseLabel ? ` · ${phaseLabel}` : ''}`
    : null;
  const phaseSnippet = phaseExpect || phaseFocus || null;
  const loggedForDay = completionScore != null && completionScore >= 100;
  const showStepsHero = hasTemplate && phaseItems.length > 0 && dayMode !== 'historical';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
        <Text allowFontScaling style={styles.title}>
          {todayScreenTitle(dayMode)}
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          {selectedDate}
        </Text>

        {showCelebrate && loggedForDay ? (
          <View style={styles.celebrateBanner}>
            <Text style={styles.celebrateText}>{celebrateBannerCopy()}</Text>
            <Pressable onPress={() => router.push('/(tabs)/timeline')}>
              <Text style={styles.celebrateLink}>Open Timeline</Text>
            </Pressable>
          </View>
        ) : null}

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
              Pick a guided program. Your daily check-in is one progress photo — we track change over time.
            </Text>
            <PrimaryButton label="Choose a routine" onPress={() => router.push('/routine/pick')} />
          </View>
        ) : null}

        {hasTemplate && weekKicker ? (
          <Text style={styles.weekKicker}>{weekKicker}</Text>
        ) : null}

        {showStepsHero ? <RoutineStepsHero steps={phaseItems} alwaysExpanded /> : null}

        {hasTemplate && allowsPhoto ? (
          <View style={styles.photoActions}>
            {loggedForDay ? (
              <Text style={styles.loggedDone}>
                {dayMode === 'today' ? 'Logged for today ✓' : `Logged for ${selectedDate} ✓`}
              </Text>
            ) : (
              <>
                <Text style={styles.photoHint}>Done with your routine? Snap your progress.</Text>
                <PrimaryButton
                  label={dayMode === 'today' ? "Log today's photo" : 'Log progress photo'}
                  onPress={openCapture}
                />
                <View style={{ height: 10 }} />
                <SecondaryButton label="Upload from library" onPress={() => void pickFromLibrary()} />
              </>
            )}
          </View>
        ) : null}

        {hasTemplate && phaseSnippet && !loggedForDay && dayMode !== 'historical' ? (
          <View style={styles.anticipateCard}>
            <Text style={styles.anticipateTitle}>What to expect</Text>
            <Text style={styles.anticipateBody}>{phaseSnippet}</Text>
          </View>
        ) : null}

        {layeringWarning && showStepsHero ? (
          <View style={styles.layerCard}>
            <Text style={styles.layerTitle}>Layering note</Text>
            <Text style={styles.layerBody}>{layeringWarning}</Text>
          </View>
        ) : null}

        {hasTemplate && (phaseNotes || assistantSummary) && dayMode === 'historical' ? (
          <View style={styles.phaseCard}>
            {assistantSummary ? <Text style={styles.phaseBody}>{assistantSummary}</Text> : null}
          </View>
        ) : null}

        {hasTemplate && phaseNotes && dayMode !== 'historical' ? (
          <View style={styles.phaseCard}>
            <Pressable
              onPress={() => setPhaseNotesOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: phaseNotesOpen }}>
              <Text style={styles.phaseExpand}>
                {phaseNotesOpen ? 'Hide phase details' : 'More about this phase'}
              </Text>
            </Pressable>
            {phaseNotesOpen && phaseNotes ? <Text style={styles.phaseNotes}>{phaseNotes}</Text> : null}
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
  subtitle: { fontFamily: JournalTokens.font.body, color: JournalTokens.color.muted, marginBottom: JournalTokens.spacing.sm },
  weekKicker: { fontWeight: '700', color: JournalTokens.color.ink, fontSize: 15, marginBottom: 4 },
  celebrateBanner: {
    backgroundColor: TimelineTokens.badgeGreenBg,
    borderRadius: JournalTokens.radius.md,
    padding: JournalTokens.spacing.md,
    marginBottom: 4,
    gap: 6,
  },
  celebrateText: { color: JournalTokens.color.ink, fontWeight: '600', fontSize: 14 },
  celebrateLink: { color: JournalTokens.color.accent, fontWeight: '700', fontSize: 14 },
  historyBanner: {
    backgroundColor: TimelineTokens.historyBannerBg,
    borderRadius: JournalTokens.radius.md,
    padding: JournalTokens.spacing.sm,
  },
  historyBannerText: { color: TimelineTokens.historyBannerFg, fontSize: 13, fontWeight: '600' },
  backfillBanner: {
    backgroundColor: TimelineTokens.backfillBannerBg,
    borderRadius: JournalTokens.radius.md,
    padding: JournalTokens.spacing.sm,
  },
  backfillBannerText: { color: TimelineTokens.backfillBannerFg, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  photoActions: { marginTop: 4, marginBottom: 8, gap: 6 },
  photoHint: { color: JournalTokens.color.muted, fontSize: 14, textAlign: 'center', marginBottom: 4 },
  loggedDone: {
    color: JournalTokens.color.success,
    fontWeight: '700',
    fontSize: 16,
    textAlign: 'center',
    paddingVertical: 14,
  },
  anticipateCard: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.md,
    gap: 6,
  },
  anticipateTitle: { fontWeight: '700', color: JournalTokens.color.ink, fontSize: 14 },
  anticipateBody: { color: JournalTokens.color.muted, lineHeight: 20, fontSize: 14 },
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
  phaseCard: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.md,
    gap: 8,
  },
  phaseBody: { color: JournalTokens.color.muted, lineHeight: 22, fontFamily: JournalTokens.font.body, fontSize: 15 },
  phaseExpand: { color: JournalTokens.color.accent, fontWeight: '600', fontSize: 13 },
  phaseNotes: { color: JournalTokens.color.muted, fontSize: 13, lineHeight: 20 },
  redCard: {
    backgroundColor: '#fef2f2',
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: JournalTokens.spacing.md,
  },
  redTitle: { fontWeight: '700', color: '#991b1b', marginBottom: 4 },
  redBody: { color: '#991b1b', fontSize: 13 },
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
});
