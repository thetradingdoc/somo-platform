'use strict';

/**
 * Single writer for opqrst_accumulator — shared by L2 opqrst-subrail and L4 triage sync.
 */

const OPQRST_FIELDS = ['O', 'P', 'Q', 'R', 'S', 'T'];
const FIELD_KEYS = {
  O: 'onset',
  P: 'provocation',
  Q: 'quality',
  R: 'region',
  S: 'severity',
  T: 'timing'
};

function emptyAccumulator() {
  return { O: null, P: null, Q: null, R: null, S: null, T: null, rich_intake: null };
}

function mergeAccumulator(existing = {}, patch = {}) {
  const acc = { ...emptyAccumulator(), ...existing, ...patch };
  for (const f of OPQRST_FIELDS) {
    const key = FIELD_KEYS[f];
    if (acc[f] && !acc[key]) acc[key] = acc[f];
    if (acc[key] && !acc[f]) acc[f] = acc[key];
  }
  return acc;
}

/** Build accumulator fields from triage_sessions row after store_triage_opqrst. */
function accumulatorFromTriageRow(row = {}) {
  const acc = emptyAccumulator();
  const map = {
    O: row.onset || row.timing,
    P: row.provocation,
    Q: row.quality,
    R: row.region || row.body_site,
    S: row.severity != null ? String(row.severity) : null,
    T: row.timing || row.onset
  };
  for (const f of OPQRST_FIELDS) {
    const v = map[f];
    if (v != null && String(v).trim()) {
      acc[f] = String(v).trim();
      acc[FIELD_KEYS[f]] = acc[f];
    }
  }
  if (row.rich_intake) {
    try {
      acc.rich_intake = typeof row.rich_intake === 'object' ? row.rich_intake : JSON.parse(row.rich_intake);
    } catch (_) {}
  }
  return acc;
}

function applyFieldUtterance(accumulator = {}, field, utterance) {
  if (!field || !utterance) return mergeAccumulator(accumulator);
  const msg = String(utterance).trim();
  if (!msg) return mergeAccumulator(accumulator);
  return mergeAccumulator(accumulator, {
    [field]: msg,
    [FIELD_KEYS[field]]: msg
  });
}

function filledCount(accumulator = {}) {
  return OPQRST_FIELDS.filter((f) => accumulator[f] || accumulator[FIELD_KEYS[f]]).length;
}

module.exports = {
  emptyAccumulator,
  mergeAccumulator,
  accumulatorFromTriageRow,
  applyFieldUtterance,
  filledCount,
  OPQRST_FIELDS,
  FIELD_KEYS
};
