import { patientGet, patientPost, patientUploadForm } from '@/lib/patient-api';

export type SkinReportPayload = {
  source?: string;
  entry_date?: string;
  program_week?: number;
  total_weeks?: number;
  phase_key?: string | null;
  phase_label?: string | null;
  photo_prompt?: boolean;
  assistant_summary?: string;
  logged_via?: string;
  storage_ref?: string | null;
  day_mode?: string | null;
  frozen_steps?: Array<{ product_name?: string; usage_time?: string; goal?: string; step_order?: number }>;
  symptom_tags?: string[];
};

export type UploadRoutineProgressPhotoParams = {
  entryDate: string;
  uri: string;
  fileName?: string;
  mimeType?: string;
  symptomTags?: string[];
};

export type UploadRoutineProgressPhotoResult = {
  assistant_summary?: string;
  completion_score?: number;
  day_mode?: string;
  skin_report?: SkinReportPayload;
};

async function ensureDailyEntryId(entryDate: string): Promise<string> {
  const daily = await patientGet(`/api/patient/routine/daily?date=${encodeURIComponent(entryDate)}`);
  const existingId = daily?.daily_entry?.id;
  if (existingId) return String(existingId);

  const created = await patientPost('/api/patient/routine/daily', {
    entry_date: entryDate,
    item_logs: [],
  });
  const newId = created?.daily_entry_id;
  if (!newId) throw new Error('Could not create daily entry.');
  return String(newId);
}

export async function uploadRoutineProgressPhoto(
  params: UploadRoutineProgressPhotoParams
): Promise<UploadRoutineProgressPhotoResult> {
  const entryDate = String(params.entryDate || '').trim();
  const uri = String(params.uri || '').trim();
  if (!entryDate || !uri) throw new Error('entryDate and uri are required.');

  const entryId = await ensureDailyEntryId(entryDate);
  const fileName = params.fileName || `progress-${Date.now()}.jpg`;
  const mimeType = params.mimeType || 'image/jpeg';
  const symptomTags = Array.isArray(params.symptomTags)
    ? params.symptomTags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
    : [];

  const form = new FormData();
  form.append('file', { uri, name: fileName, type: mimeType } as unknown as Blob);
  if (symptomTags.length) {
    form.append('symptom_tags', JSON.stringify(symptomTags));
  }

  const data = await patientUploadForm(
    `/api/patient/routine/daily/${encodeURIComponent(entryId)}/photo`,
    form
  );

  return {
    assistant_summary: data.assistant_summary ? String(data.assistant_summary) : undefined,
    completion_score: Number(data.completion_score) || undefined,
    day_mode: data.day_mode ? String(data.day_mode) : undefined,
    skin_report: data.skin_report as SkinReportPayload | undefined,
  };
}
