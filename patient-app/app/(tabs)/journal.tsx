import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, Image, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { API_BASE_URL } from '@/config';
import { JournalTokens } from '@/constants/journalTokens';

const SESSION_KEY = 'patient_session_id';
const SUBVIEWS = ['List', 'Calendar', 'Media'] as const;
type Subview = (typeof SUBVIEWS)[number];

type CalendarDay = {
  date: string;
  is_routine_day: boolean;
  has_entry: boolean;
  completion_score: number;
  has_media: boolean;
  thumbnail_url: string | null;
};

export default function JournalScreen() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<Subview>('Calendar');
  const [rows, setRows] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRange = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sid = await SecureStore.getItemAsync(SESSION_KEY);
      if (!sid) {
        setRows([]);
        setError('Sign in required to load your journal.');
        return;
      }
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 3, 0);
      const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const qs = new URLSearchParams({ start: toIso(start), end: toIso(end), timezone: tz });
      const res = await fetch(`${API_BASE_URL}/api/patient/journal/calendar-range?${qs.toString()}`, {
        headers: { 'x-session-id': sid, 'ngrok-skip-browser-warning': 'true' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Unable to load journal calendar');
      setRows(Array.isArray(data.days) ? data.days : []);
    } catch (e: any) {
      setError(e?.message || 'Unable to load journal.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRange();
  }, [loadRange]);

  const monthGroups = useMemo(() => {
    const map = new Map<string, CalendarDay[]>();
    rows.forEach((r) => {
      const key = String(r.date || '').slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(r);
    });
    return map;
  }, [rows]);

  const classify = (d?: CalendarDay) => {
    if (!d) return 'off';
    if (d.has_media) return 'media';
    if (d.has_entry) return 'logged';
    if (d.is_routine_day) return 'due';
    return 'off';
  };

  const renderCalendar = () => {
    const months = Array.from(monthGroups.keys()).sort();
    if (!months.length) {
      return <Text style={styles.empty}>No calendar data yet.</Text>;
    }
    return months.map((monthKey) => {
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
        const cls = classify(row);
        cells.push(
          <Pressable
            key={iso}
            style={[styles.day, cls === 'due' && styles.dayDue, cls === 'logged' && styles.dayLogged]}
            accessibilityRole="button"
            accessibilityLabel={`Journal day ${iso}`}
            onPress={() => router.push({ pathname: '/(tabs)/routine', params: { date: iso } })}>
            {cls === 'media' && !!row?.thumbnail_url ? (
              <>
                <Image source={{ uri: row.thumbnail_url }} style={styles.dayImage} />
                <View style={styles.dayOverlay} />
              </>
            ) : null}
            <Text style={[styles.dayNum, cls === 'media' && styles.dayNumMedia]}>{day}</Text>
          </Pressable>
        );
      }
      return (
        <View key={monthKey} style={styles.monthCard}>
          <Text style={styles.monthTitle}>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
          <View style={styles.weekRow}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, idx) => <Text key={`${monthKey}-${w}-${idx}`} style={styles.weekCell}>{w}</Text>)}</View>
          <View style={styles.grid}>{cells}</View>
        </View>
      );
    });
  };

  const renderList = () => {
    const list = rows.filter((d) => d.has_entry || d.has_media || d.is_routine_day).slice(0, 80);
    if (!list.length) return <Text style={styles.empty}>No list entries yet.</Text>;
    return (
      <View style={styles.listWrap}>
        {list.map((d) => (
          <Pressable
            key={`l-${d.date}`}
            style={styles.listRow}
            accessibilityRole="button"
            accessibilityLabel={`Open routine log for ${d.date}`}
            onPress={() => router.push({ pathname: '/(tabs)/routine', params: { date: d.date } })}>
            <Text style={styles.listDate}>{new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
            <Text style={styles.listSummary}>
              {d.has_media ? 'Photo linked' : d.has_entry ? `Logged ${Math.round(Number(d.completion_score) || 0)}%` : 'Due'}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  };

  const renderMedia = () => {
    const media = rows.filter((d) => d.has_media && d.thumbnail_url).slice(0, 36);
    if (!media.length) return <Text style={styles.empty}>No media yet.</Text>;
    return (
      <View style={styles.mediaGrid}>
        {media.map((d) => (
          <Pressable
            key={`m-${d.date}`}
            style={styles.mediaTile}
            accessibilityRole="button"
            accessibilityLabel={`Open routine log for ${d.date}`}
            onPress={() => router.push({ pathname: '/(tabs)/routine', params: { date: d.date } })}>
            <Image source={{ uri: d.thumbnail_url || '' }} style={styles.mediaImage} />
            <View style={styles.mediaLabelWrap}>
              <Text style={styles.mediaLabel}>{new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void loadRange(); }} />}>
        <Text allowFontScaling style={styles.title}>My Skin Journal</Text>
        <Text allowFontScaling style={styles.subtitle}>
          Track routines by day in list, calendar, and media views.
        </Text>

        <View style={styles.segmentRow} accessibilityLabel="Journal views">
          {SUBVIEWS.map((label) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={`${label} view`}
              onPress={() => setActiveView(label)}
              style={[styles.segmentPill, activeView === label && styles.segmentPillActive]}>
              <Text allowFontScaling style={[styles.segmentText, activeView === label && styles.segmentTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {activeView === 'Calendar' ? renderCalendar() : null}
        {activeView === 'List' ? renderList() : null}
        {activeView === 'Media' ? renderMedia() : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: JournalTokens.color.cream,
  },
  content: {
    padding: JournalTokens.spacing.lg,
    gap: JournalTokens.spacing.md,
  },
  title: {
    fontFamily: JournalTokens.font.display,
    fontSize: 34,
    color: JournalTokens.color.ink,
  },
  subtitle: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: JournalTokens.spacing.sm,
    marginTop: JournalTokens.spacing.sm,
    flexWrap: 'wrap',
  },
  segmentPill: {
    minHeight: JournalTokens.minTap,
    borderRadius: JournalTokens.radius.pill,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    paddingHorizontal: JournalTokens.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: JournalTokens.color.card,
  },
  segmentPillActive: {
    backgroundColor: '#EAF8FB',
    borderColor: JournalTokens.color.accent,
  },
  segmentText: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.muted,
    fontSize: 14,
  },
  segmentTextActive: {
    color: JournalTokens.color.ink,
    fontWeight: '700',
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
    padding: JournalTokens.spacing.sm,
    marginBottom: JournalTokens.spacing.sm,
  },
  monthTitle: {
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.muted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  weekCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    color: '#94A3B8',
    fontFamily: JournalTokens.font.body,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  day: {
    width: '13.2%',
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    backgroundColor: '#F8FAFC',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    padding: 4,
    overflow: 'hidden',
    position: 'relative',
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
  dayNum: {
    fontFamily: JournalTokens.font.body,
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '700',
    zIndex: 2,
  },
  dayNumMedia: {
    color: '#FFFFFF',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: JournalTokens.spacing.sm,
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
    fontSize: 13,
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
  error: {
    color: '#B91C1C',
    fontFamily: JournalTokens.font.body,
    fontSize: 13,
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
  link: {
    marginTop: JournalTokens.spacing.md,
    fontFamily: JournalTokens.font.body,
    color: JournalTokens.color.terracotta,
    fontWeight: '700',
  },
});

