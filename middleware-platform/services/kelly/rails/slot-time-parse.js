'use strict';

/** Extract HH:MM from a patient utterance. */
function parseSlotTimeFromMessage(message) {
  const msg = String(message || '');
  const timeColon = msg.match(/\b(?:las?\s+)?(\d{1,2}):(\d{2})\b/i);
  if (timeColon) {
    return `${timeColon[1].padStart(2, '0')}:${timeColon[2]}`;
  }
  const timeAmPm = msg.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (timeAmPm) {
    let h = parseInt(timeAmPm[1], 10);
    const ampm = timeAmPm[2].toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:00`;
  }
  return null;
}

/** Normalize stored slot time; recover HH:MM from corrupted values like "12:00 with dr. smith". */
function normalizeSlotTime(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(':');
    return `${h.padStart(2, '0')}:${m}`;
  }
  return parseSlotTimeFromMessage(s);
}

module.exports = { parseSlotTimeFromMessage, normalizeSlotTime };
