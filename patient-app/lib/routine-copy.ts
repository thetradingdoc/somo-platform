import type { RoutineDayMode } from '@/lib/routine-day-mode';

export function todayScreenTitle(dayMode: RoutineDayMode): string {
  if (dayMode === 'today') return 'Today';
  if (dayMode === 'backfill') return "Add yesterday's photo";
  return 'Past day';
}

export function layeringUnavailableCopy(): string {
  return "We'll check product pairing when you're back online.";
}

export function celebrateBannerCopy(): string {
  return 'Day logged — see your progress on Timeline.';
}
