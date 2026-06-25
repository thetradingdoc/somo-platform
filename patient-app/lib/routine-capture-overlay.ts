import { patientGet } from '@/lib/patient-api';
import { localTodayIso } from '@/lib/routine-day-mode';

function isoAddDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

type CalendarDayRow = {
  date: string;
  has_media?: boolean;
  thumbnail_url?: string | null;
};

/** Most recent logged day before targetDate with a progress photo (single calendar-range call). */
export async function fetchPriorProgressPhotoUrl(targetDate: string): Promise<{
  priorDate: string | null;
  imageUrl: string | null;
}> {
  const target = String(targetDate || '').trim();
  const today = localTodayIso();
  const from = isoAddDays(target, -14);
  const to = target > today ? today : target;

  try {
    const data = await patientGet(
      `/api/patient/journal/calendar-range?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}`
    );
    const days: CalendarDayRow[] = Array.isArray(data?.days) ? data.days : [];
    const prior = days
      .filter((d) => d.date < target && d.has_media && d.thumbnail_url)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (prior?.thumbnail_url) {
      return { priorDate: prior.date, imageUrl: String(prior.thumbnail_url) };
    }
  } catch {
    /* fallback below */
  }

  for (let back = 1; back <= 14; back += 1) {
    const iso = isoAddDays(target, -back);
    if (iso > today) continue;
    try {
      const daily = await patientGet(`/api/patient/routine/daily?date=${encodeURIComponent(iso)}`);
      const media = daily?.daily_entry?.media;
      if (!Array.isArray(media) || !media.length) continue;
      const url = media[0]?.media_url ? String(media[0].media_url) : null;
      if (url) return { priorDate: iso, imageUrl: url };
    } catch {
      /* try next day */
    }
  }
  return { priorDate: null, imageUrl: null };
}
