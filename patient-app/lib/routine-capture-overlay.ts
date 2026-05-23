import { patientGet } from '@/lib/patient-api';
import { localTodayIso } from '@/lib/routine-day-mode';

function isoAddDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function mediaUrlFromDaily(daily: any): string | null {
  const media = daily?.daily_entry?.media;
  if (!Array.isArray(media) || !media.length) return null;
  const row = media[0];
  return row?.media_url ? String(row.media_url) : null;
}

/** Most recent logged day before targetDate with a progress photo. */
export async function fetchPriorProgressPhotoUrl(targetDate: string): Promise<{
  priorDate: string | null;
  imageUrl: string | null;
}> {
  const today = localTodayIso();
  for (let back = 1; back <= 14; back += 1) {
    const iso = isoAddDays(targetDate, -back);
    if (iso > today) continue;
    try {
      const daily = await patientGet(`/api/patient/routine/daily?date=${encodeURIComponent(iso)}`);
      const url = mediaUrlFromDaily(daily);
      if (url) return { priorDate: iso, imageUrl: url };
    } catch {
      /* try next day */
    }
  }
  return { priorDate: null, imageUrl: null };
}
