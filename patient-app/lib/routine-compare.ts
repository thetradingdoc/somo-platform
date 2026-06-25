import { patientGet } from '@/lib/patient-api';

export type CompareDayPayload = {
  date: string;
  has_entry?: boolean;
  program_week?: number | null;
  phase_label?: string | null;
  assistant_summary?: string | null;
  thumbnail_url?: string | null;
  media_url?: string | null;
  frozen_steps?: Array<{ product_name?: string; usage_time?: string }>;
};

export function findPriorMediaDate(rows: Array<{ date: string; has_media?: boolean }>, fromDate: string): string | null {
  const sorted = [...rows]
    .filter((r) => r.has_media && r.date < fromDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  return sorted[0]?.date || null;
}

export async function loadCompareBundle(dateA: string, dateB: string): Promise<{
  day_a: CompareDayPayload | null;
  day_b: CompareDayPayload | null;
}> {
  try {
    const bundled = await patientGet(
      `/api/patient/routine/compare?date_a=${encodeURIComponent(dateA)}&date_b=${encodeURIComponent(dateB)}`
    );
    if (bundled?.success) {
      return { day_a: bundled.day_a || null, day_b: bundled.day_b || null };
    }
  } catch {
    /* fallback below */
  }

  const [a, b] = await Promise.all([
    patientGet(`/api/patient/routine/daily?date=${encodeURIComponent(dateA)}`),
    patientGet(`/api/patient/routine/daily?date=${encodeURIComponent(dateB)}`),
  ]);

  const mapDay = (date: string, res: any): CompareDayPayload | null => {
    const entry = res?.daily_entry;
    if (!entry) return null;
    const parsed = entry.skin_report_parsed || null;
    const media = Array.isArray(entry.media) ? entry.media[0] : null;
    return {
      date,
      program_week: parsed?.program_week ?? null,
      phase_label: parsed?.phase_label ?? null,
      assistant_summary: parsed?.assistant_summary ?? null,
      media_url: media?.media_url ? String(media.media_url) : null,
      thumbnail_url: media?.media_url ? String(media.media_url) : null,
      frozen_steps: parsed?.frozen_steps || [],
    };
  };

  return {
    day_a: mapDay(dateA, a),
    day_b: mapDay(dateB, b),
  };
}
