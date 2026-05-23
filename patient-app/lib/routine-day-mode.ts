export type RoutineDayMode = 'today' | 'backfill' | 'historical';

export function localTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIso(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveRoutineDayMode(targetDateIso: string, todayIso = localTodayIso()) {
  const target = parseIso(targetDateIso);
  const today = parseIso(todayIso);
  if (!target || !today) {
    return {
      mode: 'historical' as RoutineDayMode,
      is_mutable: false,
      allows_photo: false,
      allows_daily_post: false,
    };
  }
  const daysAgo = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (daysAgo < 0) {
    return { mode: 'historical' as RoutineDayMode, is_mutable: false, allows_photo: false, allows_daily_post: false };
  }
  if (daysAgo === 0) {
    return { mode: 'today' as RoutineDayMode, is_mutable: true, allows_photo: true, allows_daily_post: true };
  }
  if (daysAgo <= 2) {
    return { mode: 'backfill' as RoutineDayMode, is_mutable: true, allows_photo: true, allows_daily_post: false };
  }
  return { mode: 'historical' as RoutineDayMode, is_mutable: false, allows_photo: false, allows_daily_post: false };
}

export function weekdayLabel(iso: string): string {
  const d = parseIso(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}
