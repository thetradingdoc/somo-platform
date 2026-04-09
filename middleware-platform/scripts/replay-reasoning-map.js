'use strict';

const dbModule = require('../database');
const { buildReasoningMap } = require('../services/reasoning-map-service');

function main() {
  const limit = Math.max(1, Number(process.env.REASONING_REPLAY_LIMIT || 50));
  const rows = dbModule.db.prepare(`
    SELECT session_id, urgency, quality, ingredient_reactions, skin_concerns_json, triggers_json, product_taxonomy_json
    FROM triage_sessions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);

  let blocked = 0;
  let escalated = 0;
  let lowConf = 0;

  for (const row of rows) {
    const concerns = (() => {
      try { return JSON.parse(row.skin_concerns_json || '[]'); } catch (_) { return []; }
    })();
    const triggers = (() => {
      try { return JSON.parse(row.triggers_json || '[]'); } catch (_) { return []; }
    })();
    const productTaxonomy = (() => {
      try { return JSON.parse(row.product_taxonomy_json || 'null'); } catch (_) { return null; }
    })();

    const historyText = [row.quality, row.ingredient_reactions, ...(Array.isArray(concerns) ? concerns : [])].join(' ');
    const map = buildReasoningMap({
      triage: row,
      historyText,
      productTaxonomy,
      routineConflicts: [],
      primaryConcern: Array.isArray(concerns) && concerns.length ? concerns[0] : 'general_skin_concern',
      concerns,
      triggers,
      bodyAreas: [],
      intentPrimary: 'treat',
      intentSecondary: [],
      baseConfidence: 0.7
    });
    if (map?.safety_flags?.blocked) blocked += 1;
    if (map?.safety_flags?.escalated) escalated += 1;
    if (map?.confidence?.confidence_band === 'low') lowConf += 1;
  }

  const summary = {
    replayed_sessions: rows.length,
    blocked_count: blocked,
    escalated_count: escalated,
    low_confidence_count: lowConf
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();

