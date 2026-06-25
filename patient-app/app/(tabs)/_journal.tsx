import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { BillingLifecycleStatus, BillingV1 } from '@/constants/billingV1';
import { BillingTheme } from '@/constants/billingTheme';
import { JournalTokens } from '@/constants/journalTokens';
import { TimelineTokens } from '@/constants/timelineTokens';
import { BillingBadge, StatusDot } from '@/components/billing-ui';
import { ErrorCard, LoadingCard, OfflineBanner, useToast } from '@/components/billing-feedback';
import { findPriorMediaDate } from '@/lib/routine-compare';
import { patientGet, patientPatch } from '@/lib/patient-api';

const SUBVIEWS = ['Photos', 'Calendar', 'List', 'Documents'] as const;
type Subview = (typeof SUBVIEWS)[number];

type CalendarDay = {
  date: string;
  is_routine_day: boolean;
  has_entry: boolean;
  completion_score: number;
  has_media: boolean;
  photo_prompt?: boolean;
  thumbnail_url: string | null;
  program_week?: number | null;
  phase_label?: string | null;
  phase_key?: string | null;
  phase_expect_snippet?: string | null;
  day_mode?: 'today' | 'backfill' | 'historical';
  is_purge_window?: boolean;
  phase_band?: string | null;
  milestone_label?: string | null;
  has_symptoms?: boolean;
  top_symptom?: string | null;
  billing_has_due?: boolean;
  billing_has_paid?: boolean;
  billing_all_paid?: boolean;
  billing_event_count?: number;
  billing_due_cents?: number;
  billing_paid_cents?: number;
  billing_visual?: 'due' | 'paid' | 'review' | null;
};

type PhaseChip = {
  key: string;
  label: string;
  week_start: number;
  week_end: number;
};

function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function programWeekDayLabel(
  templateStartIso: string | null,
  dateIso: string,
  programWeek: number | null | undefined
): string | null {
  const week = Number(programWeek);
  if (!Number.isFinite(week) || week < 1) return null;
  if (!templateStartIso) return `W${week}`;
  const start = new Date(`${templateStartIso}T12:00:00`);
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(d.getTime())) return `W${week}`;
  const diff = Math.floor((d.getTime() - start.getTime()) / 86400000);
  if (diff < 0) return `W${week}`;
  const dayInWeek = (diff % 7) + 1;
  return `W${week}·${dayInWeek}`;
}

type BillingEvent = {
  id: string;
  title: string;
  provider_name: string | null;
  service_date: string | null;
  amount_cents: number | null;
  status: BillingLifecycleStatus | string;
  confidence_score: number | null;
  metadata?: Record<string, unknown> | null;
};

type BillingDoc = {
  id: string;
  file_name: string | null;
  created_at: string;
  parse_status?: string | null;
  confidence_score?: number | null;
};

function groupEventsByServiceDate(events: BillingEvent[]): Map<string, BillingEvent[]> {
  const m = new Map<string, BillingEvent[]>();
  for (const e of events) {
    const d = e.service_date;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!m.has(d)) m.set(d, []);
    m.get(d)!.push(e);
  }
  return m;
}

function monthKeysFromSources(rows: CalendarDay[], events: BillingEvent[]): string[] {
  const set = new Set<string>();
  rows.forEach((r) => {
    const k = String(r.date || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(k)) set.add(k);
  });
  events.forEach((e) => {
    const sd = e.service_date;
    if (sd && /^\d{4}-\d{2}-\d{2}$/.test(sd)) set.add(sd.slice(0, 7));
  });
  if (set.size === 0) {
    const d = new Date();
    set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return Array.from(set).sort();
}

function billingVisualForDay(dayEvents: BillingEvent[]): 'due' | 'paid' | 'review' | null {
  if (!dayEvents.length) return null;
  if (dayEvents.some((x) => x.status === 'due')) return 'due';
  if (dayEvents.every((x) => x.status === 'paid')) return 'paid';
  return 'review';
}

function billingVisualForCell(row: CalendarDay | undefined, dayEvents: BillingEvent[]): 'due' | 'paid' | 'review' | null {
  const v = row?.billing_visual;
  if (v === 'due' || v === 'paid' || v === 'review') return v;
  return billingVisualForDay(dayEvents);
}

function billingStatusA11y(vis: 'due' | 'paid' | 'review' | null): string {
  if (vis === 'due') return 'Bill due';
  if (vis === 'paid') return 'Paid';
  if (vis === 'review') return 'Needs review or mixed status';
  return '';
}

function computeStats(events: BillingEvent[]) {
  const billsDue = events.filter((e) => e.status === 'due').length;
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let owedMonth = 0;
  let paidMonth = 0;
  for (const e of events) {
    const sd = e.service_date || '';
    if (!sd.startsWith(ym)) continue;
    const cents = Number(e.amount_cents || 0);
    if (['due', 'needs_review', 'tracked', 'pending', 'disputed'].includes(String(e.status))) owedMonth += cents;
    if (e.status === 'paid') paidMonth += cents;
  }
  return { billsDue, owedMonth, paidMonth };
}

function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatUsd(cents: number): string {
  const n = Math.max(0, cents) / 100;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dotColorForDay(isToday: boolean, billVis: ReturnType<typeof billingVisualForDay>): string | null {
  if (!billVis) return null;
  if (billVis === 'paid') return TimelineTokens.dotPaid;
  if (isToday) return TimelineTokens.dotDue;
  return TimelineTokens.dotPending;
}

/** Non–color-only cue on calendar cells (parent row already has full a11y label). */
function billingMarkerGlyph(billVis: ReturnType<typeof billingVisualForDay>): string | null {
  if (billVis === 'due') return 'D';
  if (billVis === 'paid') return 'P';
  if (billVis === 'review') return '!';
  return null;
}

export default function JournalScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const [activeView, setActiveView] = useState<Subview>('Photos');
  const [showCalendarBills, setShowCalendarBills] = useState(false);
  const [rows, setRows] = useState<CalendarDay[]>([]);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [documents, setDocuments] = useState<BillingDoc[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [daySheetIso, setDaySheetIso] = useState<string | null>(null);
  const [routineSheetIso, setRoutineSheetIso] = useState<string | null>(null);
  const [docDetail, setDocDetail] = useState<BillingDoc | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [templateStartDate, setTemplateStartDate] = useState<string | null>(null);
  const [phaseChips, setPhaseChips] = useState<PhaseChip[]>([]);
  const [scrollToIso, setScrollToIso] = useState<string | null>(null);

  const loadRange = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      setError(null);
      setOffline(false);
      try {
        const [calendarData, eventsData, docsData] = await Promise.all([
          patientGet('/api/patient/journal/calendar-range?start=2026-01-01&end=2026-12-31&timezone=UTC'),
          patientGet('/api/patient/billing/events?limit=200'),
          patientGet('/api/patient/billing/documents?limit=200'),
        ]);
        if (calendarData && calendarData.has_template === false) {
          router.replace('/routine/pick');
          return;
        }
        const nextRows = Array.isArray(calendarData?.days) ? calendarData.days : [];
        const raw = Array.isArray(eventsData?.events) ? (eventsData.events as BillingEvent[]) : [];
        const nextDocs = Array.isArray(docsData?.documents) ? (docsData.documents as BillingDoc[]) : [];
        setRows(nextRows);
        setEvents(raw);
        setDocuments(nextDocs);
        const tplStart = calendarData?.template?.start_date;
        setTemplateStartDate(typeof tplStart === 'string' ? tplStart : null);
        try {
          const phaseRes = await patientGet(`/api/patient/routine/phase?date=${todayIsoLocal()}`);
          const phases = Array.isArray(phaseRes?.phase?.phases) ? phaseRes.phase.phases : [];
          setPhaseChips(
            phases.map((p: PhaseChip) => ({
              key: String(p.key || `${p.week_start}`),
              label: String(p.label || `Week ${p.week_start}`),
              week_start: Number(p.week_start) || 1,
              week_end: Number(p.week_end) || 1,
            }))
          );
        } catch {
          setPhaseChips([]);
        }
        setSelectedEventId((current) => current ?? raw[0]?.id ?? null);
        if (mode === 'refresh') showToast('Timeline refreshed', 'success');
      } catch (e: any) {
        const msg = e?.message || 'Unable to load timeline.';
        setError(msg);
        setOffline(/network request failed|offline|network/i.test(msg));
        setRows([]);
        setEvents([]);
        setDocuments([]);
        showToast('Timeline load failed', 'error');
      } finally {
        setRefreshing(false);
        setLoading(false);
      }
    },
    [router, showToast]
  );

  useEffect(() => {
    void loadRange();
  }, [loadRange]);

  const billingByDay = useMemo(() => groupEventsByServiceDate(events), [events]);
  const stats = useMemo(() => computeStats(events), [events]);
  const photoDays = useMemo(
    () =>
      rows
        .filter((r) => r.has_media && r.thumbnail_url)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [rows]
  );

  const monthGroups = useMemo(() => {
    const keys = monthKeysFromSources(rows, events);
    const map = new Map<string, CalendarDay[]>();
    rows.forEach((r) => {
      const key = String(r.date || '').slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(r);
    });
    keys.forEach((k) => {
      if (!map.has(k)) map.set(k, []);
    });
    return map;
  }, [rows, events]);

  const duplicateIds = useMemo(() => {
    const keyCount = new Map<string, number>();
    events.forEach((event) => {
      const key = `${event.provider_name || ''}::${event.service_date || ''}::${event.amount_cents || 0}`;
      keyCount.set(key, (keyCount.get(key) || 0) + 1);
    });
    const ids = new Set<string>();
    events.forEach((event) => {
      const key = `${event.provider_name || ''}::${event.service_date || ''}::${event.amount_cents || 0}`;
      if ((keyCount.get(key) || 0) > 1) ids.add(event.id);
    });
    return ids;
  }, [events]);

  const filteredEvents = useMemo(() => {
    const scoped = statusFilter === 'all' ? events : events.filter((e) => e.status === statusFilter);
    return scoped.sort((a, b) => String(b.service_date || '').localeCompare(String(a.service_date || '')));
  }, [events, statusFilter]);

  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId) || null, [events, selectedEventId]);

  const classifyRoutine = (d?: CalendarDay) => {
    if (!d) return 'off';
    if (d.has_media) return 'media';
    if (d.has_entry) return 'logged';
    if (d.is_routine_day) return 'due';
    return 'off';
  };

  async function persistStatus(next: BillingLifecycleStatus | string) {
    if (!selectedEvent) return;
    setStatusSaving(true);
    try {
      await patientPatch(`/api/patient/billing/events/${selectedEvent.id}`, { status: next });
      setEvents((prev) => prev.map((e) => (e.id === selectedEvent.id ? { ...e, status: next } : e)));
      showToast(`Status saved: ${next}`, 'success');
    } catch (e: any) {
      showToast(e?.message || 'Could not save status', 'error');
    } finally {
      setStatusSaving(false);
    }
  }

  const sheetDayEvents = daySheetIso ? billingByDay.get(daySheetIso) || [] : [];
  const sheetRoutineRow = daySheetIso ? rows.find((r) => r.date === daySheetIso) : undefined;

  const openCompareLatest = useCallback(() => {
    if (photoDays.length < 2) return;
    router.push({
      pathname: '/compare',
      params: { dateA: photoDays[0].date, dateB: photoDays[1].date },
    });
  }, [photoDays, router]);

  const renderPhotos = () => {
    if (!photoDays.length) {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your progress story starts here</Text>
          <Text style={styles.cardBody}>
            Log a front-facing photo from Today. Each check-in builds a filmstrip you can compare over time.
          </Text>
          <Pressable
            style={styles.inlineBtnPrimary}
            onPress={() => router.push('/routine/capture')}
            accessibilityRole="button">
            <Text style={styles.inlineBtnPrimaryText}>Log progress photo</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.photosPanel}>
        {photoDays.length >= 2 ? (
          <Pressable
            style={styles.compareLatestBtn}
            onPress={openCompareLatest}
            accessibilityRole="button"
            accessibilityLabel="Compare your two most recent progress photos">
            <Text style={styles.compareLatestText}>Compare latest</Text>
          </Pressable>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filmstrip}>
          {photoDays.map((row) => (
            <Pressable
              key={`film-${row.date}`}
              style={styles.filmFrame}
              onPress={() => setRoutineSheetIso(row.date)}
              accessibilityRole="button"
              accessibilityLabel={`Progress photo ${row.date}`}>
              <Image source={{ uri: row.thumbnail_url || '' }} style={styles.filmImage} />
              <Text style={styles.filmLabel}>
                {new Date(`${row.date}T12:00:00`).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
                {row.program_week ? ` · W${row.program_week}` : ''}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          style={styles.logPhotoBtn}
          onPress={() => router.push('/routine/capture')}
          accessibilityRole="button">
          <Text style={styles.logPhotoBtnText}>Log today&apos;s photo</Text>
        </Pressable>
      </View>
    );
  };

  const renderCalendar = () => {
    const months = Array.from(monthGroups.keys()).sort();
    const today = todayIsoLocal();
    const inlinePreview = filteredEvents.slice(0, 4);
    const routineInlinePreview =
      inlinePreview.length > 0
        ? []
        : rows
            .filter(
              (r) =>
                r.is_routine_day &&
                (r.has_media || r.photo_prompt || r.milestone_label || r.phase_expect_snippet)
            )
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 4);

    return (
      <View style={styles.calPanel}>
        <Pressable
          style={styles.billsToggle}
          onPress={() => setShowCalendarBills((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: showCalendarBills }}>
          <Text style={styles.billsToggleText}>
            {showCalendarBills ? 'Hide bills on calendar' : 'Show bills on calendar'}
          </Text>
        </Pressable>
        <View style={styles.roadmapLegend} accessibilityLabel="Timeline phase legend">
          <Text style={styles.roadmapLegendText}>Intro</Text>
          <View style={[styles.roadmapSwatch, { backgroundColor: TimelineTokens.horizonBg }]} />
          <Text style={styles.roadmapLegendText}>Purge window</Text>
          <View style={[styles.roadmapSwatch, { backgroundColor: TimelineTokens.purgeBg }]} />
        </View>
        {phaseChips.length > 0 && templateStartDate ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.phaseJumpBar}>
            {phaseChips.map((chip) => (
              <Pressable
                key={chip.key}
                style={styles.phaseChip}
                accessibilityRole="button"
                accessibilityLabel={`Jump to ${chip.label}`}
                onPress={() => {
                  const target = isoAddDays(templateStartDate, (chip.week_start - 1) * 7);
                  setScrollToIso(target);
                  router.push({ pathname: '/(tabs)/today', params: { date: target } });
                }}>
                <Text style={styles.phaseChipText} numberOfLines={1}>
                  {chip.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {months.map((monthKey) => {
          const [y, m] = monthKey.split('-').map(Number);
          const first = new Date(y, (m || 1) - 1, 1);
          const last = new Date(y, (m || 1), 0);
          const lead = first.getDay();
          const cells: React.ReactNode[] = [];
          const byIso = new Map((monthGroups.get(monthKey) || []).map((d) => [d.date, d]));
          for (let i = 0; i < lead; i += 1) cells.push(<View key={`e-${monthKey}-${i}`} style={[styles.day, styles.dayEmpty]} />);
          for (let day = 1; day <= last.getDate(); day += 1) {
            const iso = `${monthKey}-${String(day).padStart(2, '0')}`;
            const row = byIso.get(iso);
            const routineCls = classifyRoutine(row);
            const dayEv = billingByDay.get(iso) || [];
            const billVis = showCalendarBills ? billingVisualForCell(row, dayEv) : null;
            const isToday = iso === today;
            const dotColor = showCalendarBills ? dotColorForDay(isToday, billVis) : null;
            const billingCount = row?.billing_event_count ?? dayEv.length;
            const hasBilling = showCalendarBills && billingCount > 0;
            const a11yBill = billingStatusA11y(billVis);
            const billGlyph = billingMarkerGlyph(billVis);

            cells.push(
              <Pressable
                key={iso}
                style={[
                  styles.day,
                  billVis === 'due' && {
                    backgroundColor: TimelineTokens.billDueBg,
                    borderColor: TimelineTokens.billDueBorder,
                  },
                  billVis === 'paid' && {
                    backgroundColor: TimelineTokens.billPaidBg,
                    borderColor: TimelineTokens.billPaidBorder,
                  },
                  billVis === 'review' && {
                    backgroundColor: TimelineTokens.badgeAmberBg,
                    borderColor: '#EF9F27',
                  },
                  !billVis && routineCls === 'due' && styles.dayDue,
                  !billVis && routineCls === 'logged' && styles.dayLogged,
                  !billVis &&
                    routineCls === 'due' &&
                    row?.is_routine_day &&
                    !row?.has_media &&
                    styles.dayHorizon,
                  !billVis && row?.phase_band === 'purge' && row?.is_routine_day && !row?.has_media && styles.dayPurge,
                  !billVis && row?.phase_band === 'intro' && row?.is_routine_day && !row?.has_media && styles.dayHorizon,
                  scrollToIso === iso && { borderWidth: 2, borderColor: TimelineTokens.captureCtaFg },
                  isToday && { borderWidth: 1.5, borderColor: TimelineTokens.todayRing },
                ]}
                accessibilityRole="button"
                accessibilityHint={hasBilling && a11yBill ? `${a11yBill}. Opens day details.` : undefined}
                accessibilityLabel={`Day ${iso}${isToday ? ', today' : ''}${hasBilling ? `, ${billingCount} billing ${billingCount === 1 ? 'event' : 'events'}` : ''}${a11yBill ? `, ${a11yBill}` : ''}`}
                onLongPress={() => {
                  if (!row?.has_media || billVis) return;
                  const prior = findPriorMediaDate(rows, iso);
                  if (prior) {
                    router.push({
                      pathname: '/compare',
                      params: { dateA: iso, dateB: prior },
                    });
                  }
                }}
                onPress={() => {
                  if (hasBilling) setDaySheetIso(iso);
                  else if (row?.has_media || row?.has_entry) setRoutineSheetIso(iso);
                  else if (row?.is_routine_day) setRoutineSheetIso(iso);
                  else setDaySheetIso(iso);
                }}>
                {billGlyph ? (
                  <Text
                    style={[
                      styles.billMarker,
                      billVis === 'due' && { color: TimelineTokens.billDueFg },
                      billVis === 'paid' && { color: TimelineTokens.billPaidFg },
                      billVis === 'review' && { color: '#854F0B' },
                    ]}
                    importantForAccessibility="no"
                    accessibilityElementsHidden>
                    {billGlyph}
                  </Text>
                ) : null}
                {routineCls === 'media' && !!row?.thumbnail_url && billVis == null ? (
                  <>
                    <Image source={{ uri: row.thumbnail_url }} style={styles.dayImage} />
                    <View style={styles.dayOverlay} />
                    {row?.program_week ? (
                      <View style={styles.weekBadge} accessibilityLabel={`Week ${row.program_week}`}>
                        <Text style={styles.weekBadgeText}>W{row.program_week}</Text>
                      </View>
                    ) : null}
                    {row?.milestone_label ? (
                      <View style={styles.milestoneBadge}>
                        <Text style={styles.milestoneText} numberOfLines={1}>
                          {row.milestone_label}
                        </Text>
                      </View>
                    ) : null}
                    {row?.top_symptom ? (
                      <View style={styles.symptomDot}>
                        <Text style={styles.symptomDotText}>!</Text>
                      </View>
                    ) : null}
                  </>
                ) : null}
                {routineCls === 'due' && row?.is_routine_day && !row?.has_media && billVis == null ? (
                  <>
                    {programWeekDayLabel(templateStartDate, iso, row?.program_week) ? (
                      <View style={styles.weekDayBadge}>
                        <Text style={styles.weekDayBadgeText}>
                          {programWeekDayLabel(templateStartDate, iso, row?.program_week)}
                        </Text>
                      </View>
                    ) : null}
                    {row?.phase_label ? (
                      <Text style={styles.horizonHint} numberOfLines={2}>
                        {row.phase_expect_snippet || row.phase_label}
                      </Text>
                    ) : null}
                  </>
                ) : null}
                <Text
                  style={[
                    styles.dayNum,
                    routineCls === 'media' && billVis == null && styles.dayNumMedia,
                    billVis === 'due' && { color: TimelineTokens.billDueFg },
                    billVis === 'paid' && { color: TimelineTokens.billPaidFg },
                  ]}>
                  {day}
                </Text>
                {row?.photo_prompt && row?.is_routine_day && billVis == null ? (
                  <Text style={styles.photoMarker} accessibilityLabel="Progress photo suggested">📷</Text>
                ) : null}
                {dotColor ? (
                  <View style={[styles.dot, { backgroundColor: dotColor }]} importantForAccessibility="no" accessibilityElementsHidden />
                ) : null}
              </Pressable>
            );
          }
          return (
            <View key={monthKey} style={styles.monthCard}>
              <Text style={styles.monthTitle}>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
              <View style={styles.weekRow}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, idx) => (
                  <Text key={`${monthKey}-${w}-${idx}`} style={styles.weekCell}>
                    {w}
                  </Text>
                ))}
              </View>
              <View style={styles.grid}>{cells}</View>
              {showCalendarBills ? (
                <View style={styles.legendRow} accessibilityLabel="Calendar legend: bill due and paid day colors">
                  <View
                    style={styles.legendItem}
                    accessible
                    accessibilityLabel="Bill due: light blue cell, dot may appear">
                    <View style={[styles.legendSwatch, { backgroundColor: TimelineTokens.billDueBg, borderColor: TimelineTokens.billDueBorder }]} importantForAccessibility="no" />
                    <Text style={styles.legendText}>Bill due</Text>
                  </View>
                  <View
                    style={styles.legendItem}
                    accessible
                    accessibilityLabel="Paid: light green cell, dot may appear">
                    <View style={[styles.legendSwatch, { backgroundColor: TimelineTokens.billPaidBg, borderColor: TimelineTokens.billPaidBorder }]} importantForAccessibility="no" />
                    <Text style={styles.legendText}>Paid</Text>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}

        {routineInlinePreview.length > 0 ? (
          <View style={styles.inlineListWrap}>
            {routineInlinePreview.map((row) => (
              <Pressable
                key={`ril-${row.date}`}
                style={styles.inlineListRow}
                onPress={() => {
                  if (row.has_media) {
                    setRoutineSheetIso(row.date);
                  } else {
                    router.push({ pathname: '/(tabs)/today', params: { date: row.date } });
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={`Routine day ${row.date}`}>
                <View style={styles.inlineListLeft}>
                  <Text style={styles.inlineListTitle} numberOfLines={2}>
                    {row.milestone_label || row.phase_label || 'Routine day'}
                  </Text>
                  <Text style={styles.inlineListMeta} numberOfLines={2}>
                    {new Date(`${row.date}T12:00:00`).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                    {row.phase_expect_snippet ? ` · ${row.phase_expect_snippet}` : ''}
                  </Text>
                </View>
                <View style={styles.inlineListRight}>
                  {row.program_week ? (
                    <Text style={styles.inlineRoutineWeek}>W{row.program_week}</Text>
                  ) : null}
                  {row.has_media ? <Text style={styles.inlineRoutinePhoto}>Photo</Text> : null}
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {inlinePreview.length > 0 ? (
          <View style={styles.inlineListWrap}>
            {inlinePreview.map((event) => (
              <Pressable
                key={`il-${event.id}`}
                style={styles.inlineListRow}
                onPress={() => {
                  setActiveView('List');
                  setSelectedEventId(event.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${event.title}, status ${event.status}, amount ${formatUsd(Number(event.amount_cents || 0))}`}>
                <View style={styles.inlineListLeft}>
                  <Text style={styles.inlineListTitle} numberOfLines={2}>
                    {event.title}
                  </Text>
                  <Text style={styles.inlineListMeta} numberOfLines={1}>
                    {event.service_date
                      ? new Date(`${event.service_date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                      : '—'}{' '}
                    · {event.provider_name || '—'}
                  </Text>
                </View>
                <View style={styles.inlineListRight}>
                  <Text style={[styles.inlineListAmt, amountColorForStatus(event.status)]}>
                    {formatUsd(Number(event.amount_cents || 0))}
                  </Text>
                  <View style={{ marginTop: 4 }}>
                    <BillingBadge
                      tone={
                        event.status === 'paid'
                          ? 'success'
                          : event.status === 'due'
                            ? 'warning'
                            : event.status === 'disputed'
                              ? 'error'
                              : 'info'
                      }
                      label={String(event.status)}
                    />
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable
          style={styles.captureCta}
          onPress={() => router.push('/scan-entry')}
          accessibilityRole="button"
          accessibilityLabel="Capture a bill or receipt">
          <Ionicons name="camera-outline" size={18} color={TimelineTokens.captureCtaFg} />
          <Text style={styles.captureCtaText}>Capture a bill or receipt</Text>
        </Pressable>
      </View>
    );
  };

  const renderList = () => {
    if (!filteredEvents.length) {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No billing events yet</Text>
          <Text style={styles.cardBody}>Capture a bill or receipt to build your timeline — no skincare routine required.</Text>
          <Pressable style={styles.inlineBtnPrimary} onPress={() => router.push('/scan-entry')}>
            <Text style={styles.inlineBtnPrimaryText}>Capture first bill</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.listWrap}>
        <View style={styles.filterRow}>
          {['all', ...BillingV1.lifecycleStatuses].map((label) => (
            <Pressable key={label} onPress={() => setStatusFilter(label)} style={[styles.filterPill, statusFilter === label && styles.filterPillActive]}>
              <Text style={[styles.filterText, statusFilter === label && styles.filterTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {filteredEvents.map((event) => (
          <Pressable
            key={`l-${event.id}`}
            style={[styles.listRow, selectedEventId === event.id && styles.listRowSelected]}
            accessibilityRole="button"
            accessibilityLabel={`Open billing event ${event.title}`}
            onPress={() => setSelectedEventId(event.id)}>
            <View style={styles.listLeft}>
              <Text style={styles.listDate}>{event.service_date || 'Unknown date'}</Text>
              <View style={styles.listSummaryRow}>
                <StatusDot state={event.status === 'paid' ? 'completed' : event.status === 'due' ? 'pending' : 'default'} />
                <Text style={styles.listSummary} numberOfLines={2}>
                  {(event.provider_name || 'Unknown provider')} ·{' '}
                  <Text style={amountColorForStatus(event.status)}>
                    ${(Number(event.amount_cents || 0) / 100).toFixed(2)}
                  </Text>
                </Text>
              </View>
              {duplicateIds.has(event.id) ? <Text style={styles.dupWarning}>Possible duplicate</Text> : null}
            </View>
            <BillingBadge
              tone={event.status === 'paid' ? 'success' : event.status === 'due' ? 'warning' : event.status === 'disputed' ? 'error' : 'info'}
              label={String(event.status)}
            />
          </Pressable>
        ))}
        {selectedEvent ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Event detail</Text>
            <Text style={styles.cardBody}>
              {selectedEvent.title} · {selectedEvent.provider_name || 'Unknown provider'} · {selectedEvent.service_date || 'Unknown date'}
            </Text>
            <Text style={styles.cardBody}>
              Amount{' '}
              <Text style={amountColorForStatus(selectedEvent.status)}>
                ${(Number(selectedEvent.amount_cents || 0) / 100).toFixed(2)}
              </Text>{' '}
              · Confidence {Math.round((selectedEvent.confidence_score || 0) * 100)}%
            </Text>
            <View style={styles.actionRow}>
              {BillingV1.lifecycleStatuses.map((status) => (
                <Pressable
                  key={status}
                  disabled={statusSaving}
                  onPress={() => void persistStatus(status)}
                  style={[styles.filterPill, selectedEvent.status === status && styles.filterPillActive]}>
                  <Text style={[styles.filterText, selectedEvent.status === status && styles.filterTextActive]}>{status}</Text>
                </Pressable>
              ))}
              {statusSaving ? <ActivityIndicator style={{ marginLeft: 8 }} /> : null}
            </View>
            <Pressable style={styles.inlineBtnPrimary} onPress={() => router.push('/scan-entry')}>
              <Text style={styles.inlineBtnPrimaryText}>Add another capture</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  const renderDocuments = () => {
    const media = rows.filter((d) => d.has_media && d.thumbnail_url).slice(0, 18);
    const hasBilling = documents.length > 0;
    const hasRoutineMedia = media.length > 0;

    if (!hasBilling && !hasRoutineMedia) {
      return <Text style={styles.empty}>No billing documents or routine photos yet. Capture a receipt or EOB to get started.</Text>;
    }

    return (
      <View style={{ gap: JournalTokens.spacing.md }}>
        {hasBilling ? (
          <View>
            <Text style={styles.sectionHeading}>Billing documents</Text>
            <View style={styles.mediaGrid}>
              {documents.slice(0, 24).map((doc) => (
                <Pressable
                  key={doc.id}
                  style={styles.docTile}
                  onPress={() => setDocDetail(doc)}
                  accessibilityRole="button"
                  accessibilityLabel={`Billing document ${doc.file_name || doc.id}`}>
                  <Text style={styles.docTitle}>{doc.file_name || 'Billing document'}</Text>
                  <Text style={styles.docMeta}>{new Date(doc.created_at).toLocaleDateString()}</Text>
                  {doc.parse_status ? (
                    <Text style={styles.docParse}>{doc.parse_status}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {hasRoutineMedia ? (
          <View>
            <Text style={styles.sectionHeading}>Routine photos</Text>
            <Text style={styles.sectionHint}>Linked to your routine journal — not financial proof.</Text>
            <View style={styles.mediaGrid}>
              {media.map((d) => (
                <Pressable
                  key={`m-${d.date}`}
                  style={styles.mediaTile}
                  accessibilityRole="button"
                  accessibilityLabel={`Routine photo ${d.date}`}
                  onPress={() => router.push({ pathname: '/(tabs)/today', params: { date: d.date } })}>
                  <Image source={{ uri: d.thumbnail_url || '' }} style={styles.mediaImage} />
                  {d.program_week ? (
                    <View style={styles.weekBadgeGrid}>
                      <Text style={styles.weekBadgeGridText}>W{d.program_week}</Text>
                    </View>
                  ) : null}
                  <View style={styles.mediaLabelWrap}>
                    <Text style={styles.mediaLabel}>
                      {new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      {d.phase_label ? ` · ${d.phase_label}` : ''}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void loadRange('refresh'); }} />}>
        <View style={styles.headerBlock}>
          <Text allowFontScaling style={styles.title}>
            Timeline
          </Text>
          <Text allowFontScaling style={styles.subtitle}>
            Your progress photos and routine journey.
          </Text>
        </View>

        {offline ? <OfflineBanner message={BillingV1.copy.offline} /> : null}
        {loading ? <LoadingCard label="Loading timeline..." /> : null}

        <View style={styles.segmentShell} accessibilityRole="tablist" accessibilityLabel="Timeline views">
          {SUBVIEWS.map((label, idx) => (
            <Pressable
              key={label}
              accessibilityRole="tab"
              accessibilityHint={`Show ${label} on the timeline`}
              accessibilityState={{ selected: activeView === label }}
              onPress={() => setActiveView(label)}
              style={[
                styles.segmentCell,
                idx === SUBVIEWS.length - 1 && styles.segmentCellLast,
                activeView === label && styles.segmentCellActive,
              ]}>
              <Text allowFontScaling style={[styles.segmentText, activeView === label && styles.segmentTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {activeView !== 'Photos' ? (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text
                style={[
                  styles.statVal,
                  stats.billsDue > 0 ? { color: TimelineTokens.amountOwe } : { color: JournalTokens.color.ink },
                ]}>
                {stats.billsDue}
              </Text>
              <Text style={styles.statLbl}>Bills due</Text>
            </View>
            <View style={styles.statCard}>
              <Text
                style={[
                  styles.statVal,
                  stats.owedMonth > 0 ? { color: TimelineTokens.amountPending } : { color: JournalTokens.color.ink },
                ]}>
                {formatUsd(stats.owedMonth)}
              </Text>
              <Text style={styles.statLbl}>Owed this month</Text>
            </View>
            <View style={styles.statCard}>
              <Text
                style={[
                  styles.statVal,
                  stats.paidMonth > 0 ? { color: TimelineTokens.amountPaid } : { color: JournalTokens.color.ink },
                ]}>
                {formatUsd(stats.paidMonth)}
              </Text>
              <Text style={styles.statLbl}>Paid this month</Text>
            </View>
          </View>
        ) : null}

        {error ? <ErrorCard title="Unable to load timeline" message={error} onRetry={() => void loadRange('refresh')} /> : null}
        {activeView === 'Photos' ? renderPhotos() : null}
        {activeView === 'Calendar' ? renderCalendar() : null}
        {activeView === 'List' ? renderList() : null}
        {activeView === 'Documents' ? renderDocuments() : null}
      </ScrollView>

      <Modal visible={!!daySheetIso} animationType="slide" transparent onRequestClose={() => setDaySheetIso(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setDaySheetIso(null)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{daySheetIso}</Text>
            {sheetDayEvents.length ? (
              <>
                <Text style={styles.modalSection}>Billing</Text>
                {sheetDayEvents.map((ev) => (
                  <View key={ev.id} style={styles.modalRow}>
                    <Text style={styles.modalEvTitle}>{ev.title}</Text>
                    <Text style={styles.modalEvMeta}>
                      {ev.provider_name || '—'} · ${(Number(ev.amount_cents || 0) / 100).toFixed(2)} · {ev.status}
                    </Text>
                  </View>
                ))}
              </>
            ) : (
              <Text style={styles.modalEmpty}>No bills on this date.</Text>
            )}
            {sheetRoutineRow?.is_routine_day || sheetRoutineRow?.has_entry ? (
              <>
                <Text style={styles.modalSection}>Routine</Text>
                <Pressable
                  style={styles.modalLink}
                  onPress={() => {
                    setDaySheetIso(null);
                    router.push({ pathname: '/(tabs)/today', params: { date: daySheetIso || '' } });
                  }}>
                  <Text style={styles.modalLinkText}>Open routine for this day →</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable style={styles.modalClose} onPress={() => setDaySheetIso(null)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!routineSheetIso}
        animationType="slide"
        transparent
        onRequestClose={() => setRoutineSheetIso(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setRoutineSheetIso(null)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{routineSheetIso}</Text>
            {sheetRoutineRow?.thumbnail_url ? (
              <Image source={{ uri: sheetRoutineRow.thumbnail_url }} style={styles.routineSheetImage} />
            ) : null}
            {sheetRoutineRow?.milestone_label ? (
              <Text style={styles.modalEvMeta}>{sheetRoutineRow.milestone_label}</Text>
            ) : null}
            {sheetRoutineRow?.phase_expect_snippet ? (
              <Text style={styles.modalBody}>{sheetRoutineRow.phase_expect_snippet}</Text>
            ) : null}
            {sheetRoutineRow?.top_symptom ? (
              <Text style={styles.modalEvMeta}>Symptom: {sheetRoutineRow.top_symptom}</Text>
            ) : null}
            <Pressable
              style={styles.modalLink}
              onPress={() => {
                setRoutineSheetIso(null);
                router.push({ pathname: '/(tabs)/today', params: { date: routineSheetIso || '' } });
              }}>
              <Text style={styles.modalLinkText}>Open full day →</Text>
            </Pressable>
            {sheetRoutineRow?.has_media ? (
              <Pressable
                style={styles.modalLink}
                onPress={() => {
                  const prior = findPriorMediaDate(rows, routineSheetIso || '');
                  if (!prior) return;
                  setRoutineSheetIso(null);
                  router.push({ pathname: '/compare', params: { dateA: routineSheetIso || '', dateB: prior } });
                }}>
                <Text style={styles.modalLinkText}>Compare to previous photo →</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.modalClose} onPress={() => setRoutineSheetIso(null)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!docDetail} transparent animationType="fade" onRequestClose={() => setDocDetail(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setDocDetail(null)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{docDetail?.file_name || 'Document'}</Text>
            <Text style={styles.modalEvMeta}>Uploaded {docDetail ? new Date(docDetail.created_at).toLocaleString() : ''}</Text>
            {docDetail?.parse_status ? <Text style={styles.modalEvMeta}>Parse: {docDetail.parse_status}</Text> : null}
            <Pressable style={styles.modalClose} onPress={() => setDocDetail(null)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function amountColorForStatus(status: string): { color: string } {
  if (status === 'paid') return { color: TimelineTokens.amountPaid };
  if (status === 'due') return { color: TimelineTokens.amountOwe };
  return { color: TimelineTokens.amountPending };
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: JournalTokens.color.cream,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 10,
  },
  headerBlock: {
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: JournalTokens.color.line,
  },
  title: {
    fontFamily: JournalTokens.font.body,
    fontSize: 18,
    fontWeight: '500',
    color: JournalTokens.color.ink,
  },
  subtitle: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  photosPanel: { gap: 12 },
  compareLatestBtn: {
    alignSelf: 'flex-start',
    backgroundColor: JournalTokens.color.accent,
    borderRadius: JournalTokens.radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: JournalTokens.minTap,
    justifyContent: 'center',
  },
  compareLatestText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  filmstrip: { gap: 10, paddingVertical: 4 },
  filmFrame: { width: 148, marginRight: 4 },
  filmImage: {
    width: 148,
    height: 196,
    borderRadius: JournalTokens.radius.md,
    backgroundColor: JournalTokens.color.line,
  },
  filmLabel: { marginTop: 6, fontSize: 12, fontWeight: '600', color: JournalTokens.color.ink },
  logPhotoBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
    minHeight: JournalTokens.minTap,
    justifyContent: 'center',
  },
  logPhotoBtnText: { color: JournalTokens.color.accent, fontWeight: '700', fontSize: 15 },
  billsToggle: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
    minHeight: JournalTokens.minTap,
    justifyContent: 'center',
  },
  billsToggleText: { color: JournalTokens.color.accent, fontWeight: '600', fontSize: 14 },
  calPanel: {
    gap: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 4,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 0,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  statVal: {
    fontSize: 18,
    fontWeight: '500',
    fontFamily: JournalTokens.font.body,
  },
  statLbl: {
    marginTop: 2,
    fontSize: 10,
    color: JournalTokens.color.muted,
    fontFamily: JournalTokens.font.body,
  },
  segmentShell: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: TimelineTokens.segmentBorder,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: JournalTokens.color.card,
    marginTop: 10,
  },
  segmentCell: {
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 7,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: TimelineTokens.segmentBorder,
  },
  segmentCellLast: {
    borderRightWidth: 0,
  },
  segmentCellActive: {
    backgroundColor: TimelineTokens.segmentActiveBg,
  },
  segmentText: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.muted,
    fontSize: 12,
    fontWeight: '500',
  },
  segmentTextActive: {
    color: TimelineTokens.billDueFg,
    fontWeight: '600',
  },
  captureCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: TimelineTokens.captureCtaBg,
    borderWidth: 1,
    borderColor: TimelineTokens.captureCtaBorder,
  },
  captureCtaText: {
    color: TimelineTokens.captureCtaFg,
    fontFamily: JournalTokens.font.body,
    fontWeight: '500',
    fontSize: 13,
  },
  card: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.lg,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.lg,
    ...JournalTokens.shadow.card,
  },
  monthCard: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    paddingHorizontal: 0,
    paddingVertical: 8,
    marginBottom: 6,
  },
  monthTitle: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.ink,
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  weekCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 9,
    color: '#94A3B8',
    fontFamily: JournalTokens.font.body,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  day: {
    width: '14.28%',
    marginBottom: 2,
    minHeight: 30,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    paddingHorizontal: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  billMarker: {
    position: 'absolute',
    top: 1,
    left: 2,
    fontSize: 9,
    fontWeight: '700',
    fontFamily: JournalTokens.font.body,
    zIndex: 3,
    color: JournalTokens.color.muted,
  },
  dayEmpty: {
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  dayDue: {
    backgroundColor: '#ECFEFF',
    borderColor: '#BAE6FD',
  },
  dayLogged: {
    backgroundColor: '#CFFAFE',
    borderColor: '#67E8F9',
  },
  dayImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  dayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  weekBadge: {
    position: 'absolute',
    left: 3,
    bottom: 3,
    backgroundColor: TimelineTokens.weekBadgeBg,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    zIndex: 4,
  },
  weekBadgeText: {
    color: TimelineTokens.weekBadgeFg,
    fontSize: 9,
    fontWeight: '800',
  },
  weekDayBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: TimelineTokens.weekBadgeBg,
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  weekDayBadgeText: {
    color: TimelineTokens.weekBadgeFg,
    fontSize: 8,
    fontWeight: '700',
  },
  inlineRoutineWeek: { fontSize: 12, fontWeight: '700', color: JournalTokens.color.ink },
  inlineRoutinePhoto: { fontSize: 11, color: JournalTokens.color.muted, marginTop: 2 },
  weekBadgeGrid: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: TimelineTokens.weekBadgeBg,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  weekBadgeGridText: {
    color: TimelineTokens.weekBadgeFg,
    fontSize: 10,
    fontWeight: '800',
  },
  dayHorizon: {
    borderStyle: 'dashed',
    backgroundColor: TimelineTokens.horizonBg,
    borderColor: TimelineTokens.horizonBorder,
  },
  dayPurge: {
    borderColor: TimelineTokens.purgeBorder,
    backgroundColor: TimelineTokens.purgeBg,
  },
  horizonHint: {
    position: 'absolute',
    left: 2,
    right: 2,
    bottom: 2,
    fontSize: 7,
    lineHeight: 8,
    color: '#64748B',
    textAlign: 'center',
    zIndex: 2,
  },
  phaseJumpBar: {
    marginBottom: 10,
    maxHeight: 36,
  },
  phaseChip: {
    borderWidth: 1,
    borderColor: TimelineTokens.segmentBorder,
    backgroundColor: JournalTokens.color.card,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  phaseChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: JournalTokens.color.ink,
    maxWidth: 140,
  },
  roadmapLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  roadmapLegendText: { fontSize: 11, color: JournalTokens.color.muted, fontWeight: '600' },
  roadmapSwatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1, borderColor: '#cbd5e1' },
  milestoneBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    left: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 4,
    paddingHorizontal: 2,
    zIndex: 4,
  },
  milestoneText: { fontSize: 7, fontWeight: '700', color: '#854f0b' },
  symptomDot: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#f97316',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  symptomDotText: { color: '#fff', fontSize: 8, fontWeight: '800' },
  routineSheetImage: { width: '100%', height: 180, borderRadius: 10, marginVertical: 8 },
  modalBody: { color: JournalTokens.color.muted, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  photoMarker: {
    position: 'absolute',
    top: 2,
    right: 4,
    fontSize: 9,
    zIndex: 3,
  },
  dayNum: {
    fontFamily: JournalTokens.font.body,
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
    zIndex: 2,
  },
  dayNumMedia: {
    color: '#FFFFFF',
  },
  dot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    bottom: 3,
    alignSelf: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendSwatch: {
    width: 8,
    height: 8,
    borderRadius: 2,
    borderWidth: 0.5,
  },
  legendText: {
    fontSize: 9,
    color: JournalTokens.color.muted,
    fontFamily: JournalTokens.font.body,
  },
  inlineListWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: JournalTokens.color.line,
    marginTop: 4,
  },
  inlineListRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: JournalTokens.color.line,
  },
  inlineListLeft: {
    flex: 1,
    minWidth: 0,
  },
  inlineListTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: JournalTokens.color.ink,
    fontFamily: JournalTokens.font.body,
  },
  inlineListMeta: {
    fontSize: 11,
    color: JournalTokens.color.muted,
    fontFamily: JournalTokens.font.body,
    marginTop: 1,
  },
  inlineListRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  inlineListAmt: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: JournalTokens.font.body,
  },
  listWrap: {
    gap: 8,
  },
  listRow: {
    minHeight: JournalTokens.minTap,
    borderRadius: JournalTokens.radius.md,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    backgroundColor: JournalTokens.color.card,
    paddingHorizontal: JournalTokens.spacing.md,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: JournalTokens.spacing.sm,
  },
  listLeft: {
    flex: 1,
    minWidth: 0,
  },
  listRowSelected: {
    borderColor: '#85B7EB',
    backgroundColor: '#F8FBFF',
  },
  listDate: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.ink,
    fontWeight: '700',
    fontSize: 14,
  },
  listSummary: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.muted,
    fontSize: BillingTheme.typography.helper,
  },
  listSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterPill: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillActive: {
    borderColor: '#85B7EB',
    backgroundColor: '#E6F1FB',
  },
  filterText: {
    color: JournalTokens.color.muted,
    fontFamily: JournalTokens.font.body,
    fontSize: 11,
    fontWeight: '700',
  },
  filterTextActive: {
    color: '#0C447C',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  inlineBtnPrimary: {
    minHeight: 36,
    borderRadius: 10,
    backgroundColor: '#0C447C',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    marginTop: 10,
  },
  inlineBtnPrimaryText: {
    color: '#FFFFFF',
    fontFamily: JournalTokens.font.body,
    fontWeight: '700',
    fontSize: 12,
  },
  dupWarning: {
    color: '#B45309',
    fontFamily: JournalTokens.font.body,
    fontSize: 11,
    fontWeight: '700',
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mediaTile: {
    width: '31.8%',
    aspectRatio: 1,
    borderRadius: JournalTokens.radius.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  docTile: {
    width: '31.8%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: 8,
    backgroundColor: '#FFFFFF',
    minHeight: 90,
    justifyContent: 'space-between',
  },
  docTitle: {
    color: JournalTokens.color.ink,
    fontFamily: JournalTokens.font.body,
    fontSize: 12,
    fontWeight: '700',
  },
  docMeta: {
    color: JournalTokens.color.muted,
    fontFamily: JournalTokens.font.body,
    fontSize: 11,
  },
  docParse: {
    marginTop: 4,
    fontSize: 10,
    color: TimelineTokens.billDueFg,
    fontFamily: JournalTokens.font.body,
    fontWeight: '600',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  mediaLabelWrap: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  mediaLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: JournalTokens.font.body,
  },
  empty: {
    color: JournalTokens.color.muted,
    fontFamily: JournalTokens.font.body,
    fontSize: 13,
  },
  cardTitle: {
    fontFamily: JournalTokens.font.body,
    fontSize: 18,
    fontWeight: '700',
    color: JournalTokens.color.ink,
    marginBottom: JournalTokens.spacing.sm,
  },
  cardBody: {
    fontFamily: JournalTokens.font.body,
    fontSize: 15,
    color: JournalTokens.color.ink,
    lineHeight: 22,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: JournalTokens.color.ink,
    fontFamily: JournalTokens.font.body,
    marginBottom: 6,
  },
  sectionHint: {
    fontSize: 12,
    color: JournalTokens.color.muted,
    marginBottom: 8,
    fontFamily: JournalTokens.font.body,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: JournalTokens.color.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: JournalTokens.font.body,
    marginBottom: 12,
  },
  modalSection: {
    fontSize: 12,
    fontWeight: '700',
    color: JournalTokens.color.muted,
    marginTop: 8,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  modalRow: {
    marginBottom: 10,
  },
  modalEvTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: JournalTokens.color.ink,
    fontFamily: JournalTokens.font.body,
  },
  modalEvMeta: {
    fontSize: 13,
    color: JournalTokens.color.muted,
    fontFamily: JournalTokens.font.body,
    marginTop: 2,
  },
  modalEmpty: {
    fontSize: 14,
    color: JournalTokens.color.muted,
    marginBottom: 12,
    fontFamily: JournalTokens.font.body,
  },
  modalLink: {
    paddingVertical: 10,
  },
  modalLinkText: {
    color: '#0C447C',
    fontWeight: '700',
    fontSize: 15,
    fontFamily: JournalTokens.font.body,
  },
  modalClose: {
    marginTop: 16,
    alignSelf: 'flex-start',
  },
  modalCloseText: {
    color: '#0C447C',
    fontWeight: '700',
    fontSize: 15,
    fontFamily: JournalTokens.font.body,
  },
});
