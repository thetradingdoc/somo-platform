'use strict';

function parseSkinReport(raw) {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

function buildCompareDay(db, templateId, dateIso, resolveThumb) {
  const entry = db.prepare(`
    SELECT id, entry_date, skin_report, completion_score
    FROM patient_routine_daily_entries
    WHERE template_id = ? AND entry_date = ?
    LIMIT 1
  `).get(templateId, dateIso);

  if (!entry) {
    return { date: dateIso, has_entry: false };
  }

  const media = db.prepare(`
    SELECT media_url, patient_document_id
    FROM patient_routine_daily_media
    WHERE daily_entry_id = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).get(entry.id);

  const parsed = parseSkinReport(entry.skin_report);
  let thumbnailUrl = media?.media_url ? String(media.media_url) : null;
  if (!thumbnailUrl && media?.patient_document_id && typeof resolveThumb === 'function') {
    thumbnailUrl = resolveThumb(String(media.patient_document_id)) || null;
  }

  return {
    date: dateIso,
    has_entry: true,
    completion_score: Number(entry.completion_score) || 0,
    program_week: parsed?.program_week ?? null,
    phase_label: parsed?.phase_label ?? null,
    phase_key: parsed?.phase_key ?? null,
    assistant_summary: parsed?.assistant_summary ?? null,
    frozen_steps: Array.isArray(parsed?.frozen_steps) ? parsed.frozen_steps : [],
    media_url: thumbnailUrl,
    thumbnail_url: thumbnailUrl,
    symptom_tags: Array.isArray(parsed?.symptom_tags) ? parsed.symptom_tags : [],
  };
}

module.exports = { buildCompareDay, parseSkinReport };
