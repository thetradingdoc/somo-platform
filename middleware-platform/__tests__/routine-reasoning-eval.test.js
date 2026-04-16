'use strict';

/**
 * End-to-end eval: session → conflict graph → retriever → composer (local).
 * Run: node __tests__/routine-reasoning-eval.test.js
 */

const Database = require('better-sqlite3');
const { up: m028 } = require('../migrations/028_ingredient_interactions');
const { up: m029 } = require('../migrations/029_ingredient_rag_chunks');
const { up: m031 } = require('../migrations/031_user_sessions_and_knowledge_chunks');
const { up: m032 } = require('../migrations/032_knowledge_chunks_sku_columns');
const { up: m033 } = require('../migrations/033_knowledge_chunks_sku_seed');
const { up: m034 } = require('../migrations/034_product_sku_catalog');
const { up: m035 } = require('../migrations/035_knowledge_vector_index_meta');
const { createConflictGraph } = require('../services/ingredient-conflict-graph');
const { createSessionStateService } = require('../services/session-state');
const { createRetriever } = require('../services/retriever');
const {
  composeLocal,
  validateReply,
  buildSystemPrompt,
  buildUserPrompt,
  parseRoutineReplyJsonFromLlmText,
  validateExternalLlmRoutineReply,
  skuChunkSupportsConflict,
} = require('../services/composer');
const { getChunksForRoutineVerdict } = require('../services/ingredient-rag-chunks-service');
const { getRoutinePostHookSnapshot } = require('../services/routine-post-turn-hook');
const { splitTextForEmbedding } = require('../services/text-chunking');
const { embedTexts } = require('../services/embedding-stub');
const { buildRoutineReasoningPayload } = require('../services/routine-reasoning-orchestrator');
const { sortConflictsBySeverityThenRole } = require('../services/routine-conflict-priority');
const { createVectorRetrieverStub } = require('../services/vector-retriever-stub');
const { createVectorRetriever } = require('../services/vector-retriever');
const { recordVectorSyncStats, getVectorIndexMeta } = require('../services/vector-index-ops');
const { buildAgentTurnReply } = require('../services/agent-turn-reply');

let _passed = 0;
let _failed = 0;
const _failures = [];

function test(label, fn) {
  try { fn(); console.log(`  ✓  ${label}`); _passed++; }
  catch (err) { console.log(`  ✗  ${label}\n       ${err.message}`); _failed++; _failures.push({ label, message: err.message }); }
}
function section(name) { console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`); }

const db = new Database(':memory:');
m028(db);
m029(db);
m031(db);
m032(db);
m033(db);
m034(db);
m035(db);

const graph = createConflictGraph(db);
const sessions = createSessionStateService(db);
const retriever = createRetriever(db);

const ID = {
  retinol:       'cosing:retinol',
  tretinoin:     'cosing:tretinoin',
  lacticAcid:    'cosing:lactic acid',
  glycolicAcid:  'cosing:glycolic acid',
  salicylicAcid: 'cosing:salicylic acid',
  ascorbicAcid:  'cosing:ascorbic acid',
  niacinamide:   'cosing:niacinamide',
  benzylPeroxide:'cosing:benzoyl peroxide',
  copperPeptide: 'cosing:copper tripeptide-1',
  glycerin:      'cosing:glycerin',
  hyaluronicAcid:'cosing:hyaluronic acid',
};

function verdict(ingredientIds) {
  return graph.evaluateRoutine([{ time: 'pm', ingredient_ids: ingredientIds }]);
}
function chunks(v) { return retriever.getChunksForVerdict(v); }
function compose(v, bundle, sess) { return composeLocal(v, bundle, sess); }
function defaultSession(patch = {}) {
  return Object.assign({
    id: 'test', skin_goals: [], sensitivity: 'none',
    contraindications: [], current_routine: [],
    scan_data: null, journal_data: null,
  }, patch);
}

section('A — session state CRUD');

test('get missing session returns defaults', () => {
  const s = sessions.get('nonexistent-xyz');
  if (s.sensitivity !== 'none') throw new Error(`expected 'none', got ${s.sensitivity}`);
  if (!Array.isArray(s.skin_goals) || s.skin_goals.length !== 0) throw new Error('expected empty goals');
});

test('set and get round-trips correctly', () => {
  sessions.set('user1', {
    skin_goals: ['brighten', 'hydrate'],
    sensitivity: 'mild',
    contraindications: ['pregnant'],
    current_routine: [
      { time: 'am', products: [{ product_id: 'p1', name: 'Vit C serum', ingredient_ids: [ID.ascorbicAcid] }] },
      { time: 'pm', products: [{ product_id: 'p2', name: 'Retinol cream', ingredient_ids: [ID.retinol] }] },
    ],
  });
  const s = sessions.get('user1');
  if (s.skin_goals.join(',') !== 'brighten,hydrate') throw new Error('goals wrong');
  if (s.sensitivity !== 'mild') throw new Error('sensitivity wrong');
  if (!s.contraindications.includes('pregnant')) throw new Error('contraindications wrong');
  if (s.current_routine.length !== 2) throw new Error('routine length wrong');
});

test('merge only patches supplied fields', () => {
  sessions.set('user2', { skin_goals: ['acne'], sensitivity: 'none' });
  sessions.merge('user2', { sensitivity: 'moderate' });
  const s = sessions.get('user2');
  if (s.sensitivity !== 'moderate') throw new Error('sensitivity not updated');
  if (!s.skin_goals.includes('acne')) throw new Error('goals clobbered by merge');
});

test('duplicate goals deduped', () => {
  sessions.set('user3', { skin_goals: ['brighten', 'brighten', 'hydrate'] });
  const s = sessions.get('user3');
  if (s.skin_goals.filter((g) => g === 'brighten').length > 1) throw new Error('duplicates not removed');
});

test('invalid skin_goal throws RangeError', () => {
  let threw = false;
  try { sessions.set('user4', { skin_goals: ['teleportation'] }); }
  catch (e) { if (e instanceof RangeError) threw = true; }
  if (!threw) throw new Error('expected RangeError for unknown goal');
});

test('invalid sensitivity throws RangeError', () => {
  let threw = false;
  try { sessions.set('user4', { sensitivity: 'extreme' }); }
  catch (e) { if (e instanceof RangeError) threw = true; }
  if (!threw) throw new Error('expected RangeError for unknown sensitivity');
});

test('invalid contraindication throws RangeError', () => {
  let threw = false;
  try { sessions.set('user4', { contraindications: ['vegan'] }); }
  catch (e) { if (e instanceof RangeError) threw = true; }
  if (!threw) throw new Error('expected RangeError for unknown contraindication');
});

test('toRoutineSlots flattens ingredient_ids across products', () => {
  sessions.set('slots-test', {
    current_routine: [
      { time: 'am', products: [
        { product_id: 'p1', name: 'A', ingredient_ids: [ID.ascorbicAcid] },
        { product_id: 'p2', name: 'B', ingredient_ids: [ID.niacinamide] },
      ]},
    ],
  });
  const slots = sessions.toRoutineSlots('slots-test');
  if (slots[0].ingredient_ids.length !== 2) throw new Error('ingredient_ids not flattened');
  if (!Array.isArray(slots[0].steps) || slots[0].steps.length !== 2) throw new Error('expected steps[] for graph');
});

test('session accepts wash_off, leave_on, exposure, step_order', () => {
  sessions.set('rich-slot', {
    current_routine: [
      {
        time: 'pm',
        step_order: 0,
        products: [
          {
            product_id: 'cln',
            name: 'Cleanser',
            ingredient_ids: [ID.salicylicAcid],
            wash_off: true,
            leave_on: false,
            exposure: 'indoor',
          },
          {
            product_id: 'ret',
            name: 'Retinol',
            ingredient_ids: [ID.retinol],
            wash_off: false,
            leave_on: true,
            exposure: 'unknown',
          },
        ],
      },
    ],
  });
  const s = sessions.get('rich-slot');
  if (s.current_routine[0].products[0].wash_off !== true) throw new Error('wash_off not stored');
  if (s.current_routine[0].products[1].leave_on !== true) throw new Error('leave_on not stored');
});

test('invalid exposure throws', () => {
  let threw = false;
  try {
    sessions.set('bad-exp', {
      current_routine: [
        {
          time: 'am',
          products: [{ product_id: 'x', name: 'x', ingredient_ids: [], exposure: 'mars' }],
        },
      ],
    });
  } catch (e) {
    if (e instanceof RangeError) threw = true;
  }
  if (!threw) throw new Error('expected RangeError for bad exposure');
});

test('getContextBundle summarizes session', () => {
  sessions.set('ctx-b1', {
    skin_goals: ['barrier'],
    sensitivity: 'mild',
    contraindications: [],
    current_routine: [
      {
        time: 'am',
        products: [{ product_id: 's', name: 'Serum', ingredient_ids: [ID.ascorbicAcid], exposure: 'outdoor' }],
      },
    ],
  });
  const b = sessions.getContextBundle('ctx-b1');
  if (!b || !b.has_outdoor_exposure_step) throw new Error('expected outdoor flag');
  if (b.routine_slot_count !== 1) throw new Error('slot count');
  if (!b.skin_goals.includes('barrier')) throw new Error('goals');
});

test('getRoutineForEvaluation returns slots + contraindications + context_bundle', () => {
  sessions.set('eval-b1', {
    current_routine: [
      { time: 'pm', products: [{ product_id: 'p', name: 'P', ingredient_ids: [ID.retinol] }] },
    ],
    contraindications: ['pregnant'],
  });
  const r = sessions.getRoutineForEvaluation('eval-b1');
  if (!r || !Array.isArray(r.slots) || r.slots.length !== 1) throw new Error('slots');
  if (!r.contraindications.includes('pregnant')) throw new Error('contra');
  if (!r.context_bundle || typeof r.context_bundle.has_outdoor_exposure_step !== 'boolean') {
    throw new Error('context_bundle');
  }
});

section('A2–A6 — catalog roles, evaluation packet, exposure');

test('catalog infers sunscreen role from products row (A2)', () => {
  db.exec(
    'CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT, category TEXT, tags TEXT);',
  );
  db.prepare('INSERT OR REPLACE INTO products (id, name, category, tags) VALUES (?,?,?,?)').run(
    'sku-sun-a2',
    'SPF 50 Mineral Sunscreen',
    'sun care',
    '',
  );
  sessions.set('cat-sun', {
    current_routine: [
      {
        time: 'am',
        products: [
          { product_id: 'sku-sun-a2', name: 'Sun', ingredient_ids: [ID.ascorbicAcid], role: 'unknown' },
        ],
      },
    ],
  });
  const slots = sessions.toRoutineSlots('cat-sun');
  if (slots[0].steps[0].role !== 'sunscreen') throw new Error(`role ${slots[0].steps[0].role}`);
});

test('buildRoutineReasoningPayload enriches slots from catalog when session id set (A5)', () => {
  db.prepare('INSERT OR REPLACE INTO products (id, name, category, tags) VALUES (?,?,?,?)').run(
    'p-cleanser-orch',
    'Daily Foaming Cleanser',
    'cleanser',
    '',
  );
  sessions.set('orch-cat', {
    current_routine: [
      {
        time: 'pm',
        products: [
          {
            product_id: 'p-cleanser-orch',
            name: 'X',
            ingredient_ids: [ID.glycerin],
            role: 'unknown',
          },
        ],
      },
    ],
  });
  const payload = buildRoutineReasoningPayload({
    db,
    sessionId: 'orch-cat',
    slots: [],
    userMessage: 'check',
  });
  const role = payload.slots[0] && payload.slots[0].steps[0] && payload.slots[0].steps[0].role;
  if (role !== 'cleanser') throw new Error(`expected cleanser, got ${role}`);
});

test('buildUserPrompt includes context_bundle and step role/exposure (A5/A6)', () => {
  const session = defaultSession({
    current_routine: [
      {
        time: 'am',
        products: [
          {
            product_id: 'x',
            name: 'Serum',
            ingredient_ids: [ID.niacinamide],
            role: 'serum',
            exposure: 'outdoor',
          },
        ],
      },
    ],
  });
  const bundle = {
    skin_goals: ['acne'],
    sensitivity: 'moderate',
    contraindications: ['pregnant'],
    has_outdoor_exposure_step: true,
  };
  const u = buildUserPrompt('hello', session, bundle);
  if (!u.includes('SESSION SUMMARY')) throw new Error('missing summary');
  if (!u.includes('outdoor_exposure_step: yes')) throw new Error('outdoor');
  if (!u.includes('role=serum')) throw new Error('role');
});

section('B — retriever coverage');

test('retinol + lactic acid verdict has ≥1 chunk', () => {
  const v = verdict([ID.retinol, ID.lacticAcid]);
  const b = chunks(v);
  if (b.chunks.length === 0) throw new Error('no chunks for retinol+lactic acid');
  const first = b.chunks[0];
  if (first.chunk_source_tier !== 'knowledge_pair') {
    throw new Error(`expected pair-tier chunk first, got ${first.chunk_source_tier}`);
  }
});

test('retinol + benzoyl peroxide has chunk', () => {
  const v = verdict([ID.retinol, ID.benzylPeroxide]);
  const b = chunks(v);
  if (b.chunks.length === 0) throw new Error('no chunks for retinol+benzoyl peroxide');
});

test('ascorbic acid + niacinamide has contested chunk', () => {
  const v = verdict([ID.ascorbicAcid, ID.niacinamide]);
  const b = chunks(v);
  const contested = b.chunks.filter((c) => c.evidence_level === 'contested');
  if (contested.length === 0) throw new Error('expected a contested chunk for niacinamide+vitC');
});

test('chunk_ids is non-empty array', () => {
  const v = verdict([ID.retinol, ID.lacticAcid]);
  const b = chunks(v);
  if (!Array.isArray(b.chunk_ids) || b.chunk_ids.length === 0) throw new Error('chunk_ids empty');
});

test('coverage report produced for each conflict', () => {
  const v = verdict([ID.retinol, ID.lacticAcid]);
  const b = chunks(v);
  if (!Array.isArray(b.coverage)) throw new Error('coverage not an array');
  if (b.coverage.length !== v.conflicts.length) throw new Error('coverage length mismatch');
});

test('getChunksForIngredient returns single-ingredient context', () => {
  const result = retriever.getChunksForIngredient(ID.retinol);
  if (!Array.isArray(result)) throw new Error('not an array');
  const ids = result.map((c) => c.id);
  if (!ids.includes('retinol-mechanism-001')) throw new Error('retinol-mechanism-001 not found');
});

test('getChunksForPair returns pair chunks', () => {
  const result = retriever.getChunksForPair(ID.retinol, ID.lacticAcid);
  if (result.length === 0) throw new Error('no pair chunks');
  if (!result.some((c) => c.id === 'retinol-aha-irritation-001')) throw new Error('expected retinol-aha-irritation-001');
});

test('FTS search finds relevant chunk', () => {
  const result = retriever.searchChunks('retinol oxidation benzoyl peroxide');
  if (result.length === 0) throw new Error('FTS returned no results');
});

test('safe-only verdict returns empty chunk list', () => {
  const v = verdict([ID.glycerin, ID.hyaluronicAcid]);
  const b = chunks(v);
  if (b.chunks.length !== 0) throw new Error(`expected 0 chunks for safe pair, got ${b.chunks.length}`);
});

section('C — composer schema compliance');

test('composeLocal produces valid RoutineReply', () => {
  const v = verdict([ID.retinol, ID.lacticAcid]);
  const b = chunks(v);
  const reply = compose(v, b, defaultSession());
  const { valid, errors } = validateReply(reply);
  if (!valid) throw new Error(`invalid reply: ${errors.join('; ')}`);
});

test('overall field matches verdict overall', () => {
  const v = verdict([ID.retinol, ID.lacticAcid]);
  const reply = compose(v, chunks(v), defaultSession());
  if (reply.overall !== v.overall) throw new Error(`reply.overall "${reply.overall}" !== verdict.overall "${v.overall}"`);
});

test('every verdict conflict appears in reply.conflicts', () => {
  const v = verdict([ID.retinol, ID.lacticAcid, ID.ascorbicAcid]);
  const reply = compose(v, chunks(v), defaultSession());
  if (reply.conflicts.length < v.conflicts.length) {
    throw new Error(`reply has ${reply.conflicts.length} conflicts, verdict has ${v.conflicts.length}`);
  }
});

test('cited_chunk_ids is non-empty when chunks exist', () => {
  const v = verdict([ID.retinol, ID.lacticAcid]);
  const b = chunks(v);
  const reply = compose(v, b, defaultSession());
  if (b.chunks.length > 0 && reply.cited_chunk_ids.length === 0) {
    throw new Error('chunks available but cited_chunk_ids is empty');
  }
});

test('sensitive_note populated for moderate sensitivity', () => {
  const v = verdict([ID.retinol, ID.lacticAcid]);
  const reply = compose(v, chunks(v), defaultSession({ sensitivity: 'moderate' }));
  if (!reply.sensitive_note) throw new Error('sensitive_note should be set for moderate sensitivity');
});

test('sensitive_note null for no sensitivity', () => {
  const v = verdict([ID.glycerin]);
  const reply = compose(v, chunks(v), defaultSession({ sensitivity: 'none' }));
  if (reply.sensitive_note !== null) throw new Error('sensitive_note should be null when sensitivity=none');
});

test('safe_to_combine lists unconstrained ingredients', () => {
  const v = verdict([ID.retinol, ID.lacticAcid, ID.glycerin]);
  const reply = compose(v, chunks(v), defaultSession());
  if (!reply.safe_to_combine.includes('glycerin')) {
    throw new Error(`glycerin should be in safe_to_combine, got: ${reply.safe_to_combine}`);
  }
});

test('narrative contains "avoid" when overall is avoid', () => {
  const v = verdict([ID.retinol, ID.lacticAcid]);
  const reply = compose(v, chunks(v), defaultSession());
  if (v.overall === 'avoid' && !reply.narrative.toLowerCase().includes('avoid')) {
    throw new Error('narrative should contain "avoid" when overall is avoid');
  }
});

test('safe routine produces overall=safe reply', () => {
  const v = verdict([ID.glycerin, ID.hyaluronicAcid, ID.niacinamide]);
  const reply = compose(v, chunks(v), defaultSession());
  if (reply.overall !== 'safe') throw new Error(`expected safe, got ${reply.overall}`);
  if (reply.conflicts.length !== 0) throw new Error('expected no conflicts');
});

section('D — nasty eval cases (backlog)');

test('NASTY: retinoid + AHA full pipeline → avoid with chunks + cited', () => {
  const v = verdict([ID.tretinoin, ID.glycolicAcid]);
  const b = chunks(v);
  const reply = compose(v, b, defaultSession());
  if (reply.overall !== 'avoid') throw new Error(`expected avoid, got ${reply.overall}`);
  const { valid, errors } = validateReply(reply);
  if (!valid) throw new Error(`schema invalid: ${errors.join('; ')}`);
  if (reply.cited_chunk_ids.length === 0) throw new Error('no citations on nasty case');
});

test('NASTY: retinol + AHA + BHA triple conflict', () => {
  const v = verdict([ID.retinol, ID.lacticAcid, ID.salicylicAcid]);
  const b = chunks(v);
  const reply = compose(v, b, defaultSession());
  if (reply.overall !== 'avoid') throw new Error(`expected avoid, got ${reply.overall}`);
  if (reply.conflicts.length < 2) throw new Error(`expected ≥2 conflicts, got ${reply.conflicts.length}`);
  const { valid, errors } = validateReply(reply);
  if (!valid) throw new Error(errors.join('; '));
});

test('NASTY: BP + retinol + vitamin C all-oxidant conflict', () => {
  const v = verdict([ID.benzylPeroxide, ID.retinol, ID.ascorbicAcid]);
  const b = chunks(v);
  const reply = compose(v, b, defaultSession());
  if (reply.overall !== 'avoid') throw new Error(`expected avoid, got ${reply.overall}`);
  const { valid } = validateReply(reply);
  if (!valid) throw new Error('schema invalid');
});

test('NASTY: kitchen-sink 8-ingredient routine', () => {
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [ID.ascorbicAcid, ID.niacinamide, ID.salicylicAcid, ID.benzylPeroxide] },
    { time: 'pm', ingredient_ids: [ID.retinol, ID.lacticAcid, ID.glycolicAcid, ID.copperPeptide] },
  ]);
  const b = chunks(v);
  const reply = compose(v, b, defaultSession());
  if (reply.overall !== 'avoid') throw new Error(`expected avoid, got ${reply.overall}`);
  if (reply.conflicts.length < 4) throw new Error(`expected ≥4 conflicts, got ${reply.conflicts.length}`);
  const { valid, errors } = validateReply(reply);
  if (!valid) throw new Error(errors.join('; '));
});

test('NASTY: contested vitamin C + niacinamide — NOT avoid, IS caution', () => {
  const v = verdict([ID.ascorbicAcid, ID.niacinamide]);
  const reply = compose(v, chunks(v), defaultSession());
  if (reply.overall === 'avoid') throw new Error('contested pair must not be avoid');
  if (reply.overall !== 'caution') throw new Error(`expected caution, got ${reply.overall}`);
  const niaCon = reply.conflicts.find((c) =>
    (c.ingredient_a.includes('niacinamide') || c.ingredient_b.includes('niacinamide')) &&
    (c.ingredient_a.includes('ascorbic') || c.ingredient_b.includes('ascorbic'))
  );
  if (!niaCon) throw new Error('niacinamide+vitC conflict not in reply');
  if (niaCon.verdict !== 'info') throw new Error(`expected info verdict for contested pair, got ${niaCon.verdict}`);
});

test('NASTY: pregnant user with retinol → contraindication warning emitted', () => {
  const v = verdict([ID.retinol, ID.glycerin]);
  const reply = compose(v, chunks(v), defaultSession({ contraindications: ['pregnant'] }));
  if (reply.contraindication_warnings.length === 0) {
    throw new Error('expected pregnancy + retinol warning');
  }
  const hasRetinoidWarning = reply.contraindication_warnings.some((w) =>
    w.toLowerCase().includes('retinoid')
  );
  if (!hasRetinoidWarning) throw new Error('warning should mention retinoid');
});

test('NASTY: on_rx_retinoid + OTC retinol → duplicate retinoid warning', () => {
  const v = verdict([ID.retinol, ID.glycerin]);
  const reply = compose(v, chunks(v), defaultSession({ contraindications: ['on_rx_retinoid'] }));
  if (reply.contraindication_warnings.length === 0) {
    throw new Error('expected cumulative retinoid warning');
  }
});

section('E — schema hardening (validateReply)');

test('valid reply passes', () => {
  const v = verdict([ID.retinol, ID.lacticAcid]);
  const reply = compose(v, chunks(v), defaultSession());
  const { valid } = validateReply(reply);
  if (!valid) throw new Error('valid reply rejected');
});

test('missing overall → invalid', () => {
  const { valid } = validateReply({ conflicts: [], safe_to_combine: [], narrative: 'ok', cited_chunk_ids: [], reason_codes: [] });
  if (valid) throw new Error('should be invalid without overall');
});

test('empty narrative → invalid', () => {
  const v = verdict([ID.glycerin]);
  const reply = compose(v, chunks(v), defaultSession());
  const bad = { ...reply, narrative: '' };
  const { valid } = validateReply(bad);
  if (valid) throw new Error('should be invalid with empty narrative');
});

test('conflict missing citation_ids → invalid', () => {
  const bad = {
    overall: 'avoid',
    conflicts: [{ ingredient_a: 'retinol', ingredient_b: 'lactic acid', verdict: 'avoid', reason: 'bad', citation_ids: [] }],
    safe_to_combine: [], narrative: 'avoid using these', cited_chunk_ids: [], reason_codes: [],
  };
  const { valid, errors } = validateReply(bad);
  if (valid) throw new Error('should be invalid — citation_ids empty');
  if (!errors.some((e) => e.includes('citation_ids'))) throw new Error('error should mention citation_ids');
});

test('LLM softening: overall=avoid but conflict.verdict=info → caught', () => {
  const bad = {
    overall: 'avoid',
    conflicts: [{ ingredient_a: 'retinol', ingredient_b: 'lactic acid', verdict: 'info', reason: 'meh', citation_ids: ['retinol-aha-irritation-001'] }],
    safe_to_combine: [], narrative: 'avoid', cited_chunk_ids: ['retinol-aha-irritation-001'], reason_codes: [],
    sensitive_note: null, contraindication_warnings: [],
  };
  const { valid, errors } = validateReply(bad);
  if (valid) throw new Error('should have caught softened verdict');
  if (!errors.some((e) => e.includes('softened'))) throw new Error('error message should say "softened"');
});

test('buildSystemPrompt contains verdict overall', () => {
  const v = verdict([ID.retinol, ID.lacticAcid]);
  const b = chunks(v);
  const s = defaultSession();
  const prompt = buildSystemPrompt(v, b, s);
  if (!prompt.includes(v.overall)) throw new Error('system prompt missing overall verdict');
  if (!prompt.includes('BINDING RULES')) throw new Error('system prompt missing BINDING RULES section');
});

test('buildSystemPrompt contains chunk IDs', () => {
  const v = verdict([ID.retinol, ID.lacticAcid]);
  const b = chunks(v);
  const prompt = buildSystemPrompt(v, b, defaultSession());
  for (const ch of b.chunks) {
    if (!prompt.includes(ch.id)) throw new Error(`chunk ID "${ch.id}" missing from system prompt`);
  }
});

test('buildSystemPrompt adds SPF context when routine has outdoor exposure', () => {
  const v = verdict([ID.glycerin]);
  const b = chunks(v);
  const s = defaultSession({
    current_routine: [
      {
        time: 'am',
        products: [
          { product_id: 'd', name: 'Day', ingredient_ids: [ID.glycerin], exposure: 'outdoor' },
        ],
      },
    ],
  });
  const prompt = buildSystemPrompt(v, b, s);
  if (!/SPF|broad-spectrum/i.test(prompt)) throw new Error('expected SPF guidance in prompt');
});

test('buildUserPrompt includes routine summary', () => {
  const s = sessions.get('user1');
  const prompt = buildUserPrompt('Is my routine safe?', s);
  if (!prompt.includes('AM:') && !prompt.includes('PM:')) throw new Error('routine summary missing from user prompt');
});

section('F — batch 2 (A2/A3/D1/D3/B2/C1)');

test('invalid product role throws RangeError', () => {
  let threw = false;
  try {
    sessions.set('bad-role', {
      current_routine: [
        {
          time: 'am',
          products: [{ product_id: 'x', name: 'x', ingredient_ids: [], role: 'spaceship' }],
        },
      ],
    });
  } catch (e) {
    if (e instanceof RangeError) threw = true;
  }
  if (!threw) throw new Error('expected RangeError for unknown role');
});

test('D3: greeting + empty routine short-circuits orchestrator', () => {
  const payload = buildRoutineReasoningPayload({
    db,
    sessionId: 'nonexistent-shortcircuit',
    slots: [],
    userMessage: 'Hi there!',
  });
  if (payload.short_circuit !== 'greeting_no_routine') throw new Error('expected short_circuit flag');
  if (payload.system_prompt !== null) throw new Error('expected null system_prompt on short-circuit');
  if (!payload.validation.valid) throw new Error('short-circuit reply should validate');
  if (!payload.routine_reply.narrative.includes('routine')) throw new Error('expected onboarding narrative');
});

test('D1: agentTurn envelope has schema_version and kind', () => {
  const payload = buildRoutineReasoningPayload({
    db,
    slots: [{ time: 'pm', ingredient_ids: [ID.retinol, ID.lacticAcid] }],
    userMessage: 'check',
  });
  if (!payload.agentTurn || payload.agentTurn.schema_version !== '1') throw new Error('agentTurn schema');
  if (payload.agentTurn.kind !== 'routine_reasoning') throw new Error('agentTurn kind');
  if (!payload.agentTurn.verdict_summary || payload.agentTurn.verdict_summary.overall !== 'avoid') {
    throw new Error('verdict_summary');
  }
});

test('A3: sortConflictsBySeverityThenRole orders by role impact within same severity', () => {
  const normalized = [
    {
      time: 'pm',
      step_order: 0,
      steps: [
        { order: 0, ingredient_ids: ['cosing:a'], wash_off: false, leave_on: true, role: 'cleanser' },
        { order: 1, ingredient_ids: ['cosing:b'], wash_off: false, leave_on: true, role: 'serum' },
        { order: 2, ingredient_ids: ['cosing:c'], wash_off: false, leave_on: true, role: 'cleanser' },
      ],
    },
  ];
  const conflicts = [
    { severity: 'high', ingredient_a: 'a', ingredient_b: 'c', interaction_type: 'x', spacing_hours: 8, notes: '', evidence_level: 'established', verdict: 'caution', reason_codes: [] },
    { severity: 'high', ingredient_a: 'a', ingredient_b: 'b', interaction_type: 'x', spacing_hours: 8, notes: '', evidence_level: 'established', verdict: 'caution', reason_codes: [] },
  ];
  const sorted = sortConflictsBySeverityThenRole(conflicts, normalized);
  if (sorted[0].ingredient_b !== 'b') throw new Error('expected higher-impact pair (a+b serum) first');
});

test('C1: vector retriever stub returns empty array', async () => {
  const v = createVectorRetrieverStub();
  const out = await v.search('vitamin c serum');
  if (!Array.isArray(out) || out.length !== 0) throw new Error('stub should return []');
});

test('B2: productIds filter drops SKU-scoped chunks', () => {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO knowledge_chunks
        (id, ingredient_a, ingredient_b, reason_codes, text, source, evidence_level, product_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'zz-sku-filter-test',
      'cosing:copper tripeptide-1',
      'cosing:ascorbic acid',
      '["efficacy_degradation"]',
      'filter test body',
      'test',
      'established',
      'product_exclusive_1',
    );
  } catch (e) {
    throw new Error(`insert test chunk: ${e.message}`);
  }
  const v = graph.evaluateRoutine([{ time: 'am', ingredient_ids: [ID.copperPeptide, ID.ascorbicAcid] }]);
  const r = createRetriever(db);
  const all = r.getChunksForVerdict(v);
  const filtered = r.getChunksForVerdict(v, { productIds: ['some_other_product'] });
  const hasZzAll = all.chunks.some((c) => c.id === 'zz-sku-filter-test');
  const hasZzFiltered = filtered.chunks.some((c) => c.id === 'zz-sku-filter-test');
  if (!hasZzAll) throw new Error('expected test chunk in unfiltered bundle');
  if (hasZzFiltered) throw new Error('expected test chunk excluded when productIds mismatch');
});

test('buildAgentTurnReply exposes flags', () => {
  const env = buildAgentTurnReply({
    verdict: { overall: 'safe', conflicts: [], reason_codes: [] },
    chunkBundle: { chunks: [], chunk_ids: [] },
    validation: { valid: true, errors: [] },
    routine_reply: { overall: 'safe' },
    flags: { short_circuit: 'test' },
  });
  if (env.flags.short_circuit !== 'test') throw new Error('flags not passed');
});

section('G — batch 3 (B3/B6/A4/C2/D2/D5)');

test('B3: SKU seed row exists and is retrievable for demo product', () => {
  const row = db.prepare('SELECT id, product_id, sku FROM knowledge_chunks WHERE id = ?').get(
    'sku-seed-demo-vitc-mono-001',
  );
  if (!row || row.product_id !== 'doclittle_demo_vitc_serum') throw new Error('seed row missing');
  const mono = retriever.getChunksForIngredient('cosing:ascorbic acid');
  if (!mono.some((c) => c.id === 'sku-seed-demo-vitc-mono-001')) throw new Error('seed not in ingredient retrieval');
});

test('B6: duplicate ingredient ids in one slot do not multiply conflicts', () => {
  const v1 = graph.evaluateRoutine([{ time: 'pm', ingredient_ids: [ID.retinol, ID.lacticAcid] }]);
  const v2 = graph.evaluateRoutine([
    { time: 'pm', ingredient_ids: [ID.retinol, ID.retinol, ID.lacticAcid, ID.lacticAcid] },
  ]);
  if (v1.conflicts.length !== v2.conflicts.length) {
    throw new Error('dedup should keep conflict count stable');
  }
});

test('B6: composeLocal narrative does not invent concentration percentages', () => {
  const v = verdict([ID.glycerin]);
  const reply = compose(v, chunks(v), defaultSession());
  if (/\d+\s*%/.test(reply.narrative)) {
    throw new Error('avoid invented % concentrations in deterministic compose');
  }
});

test('A4: tertiary sort prefers higher minimum role weight when sums tie', () => {
  const normalized = [
    {
      time: 'pm',
      step_order: 0,
      steps: [
        { order: 0, ingredient_ids: ['cosing:a'], wash_off: false, leave_on: true, role: 'serum' },
        { order: 1, ingredient_ids: ['cosing:b'], wash_off: false, leave_on: true, role: 'moisturizer' },
        { order: 2, ingredient_ids: ['cosing:c'], wash_off: false, leave_on: true, role: 'treatment' },
        { order: 3, ingredient_ids: ['cosing:d'], wash_off: false, leave_on: true, role: 'cleanser' },
      ],
    },
  ];
  const conflicts = [
    { severity: 'high', ingredient_a: 'a', ingredient_b: 'b', interaction_type: 'x', spacing_hours: 8, notes: '', evidence_level: 'established', verdict: 'caution', reason_codes: [] },
    { severity: 'high', ingredient_a: 'c', ingredient_b: 'd', interaction_type: 'x', spacing_hours: 8, notes: '', evidence_level: 'established', verdict: 'caution', reason_codes: [] },
  ];
  const sorted = sortConflictsBySeverityThenRole(conflicts, normalized);
  if (sorted[0].ingredient_a !== 'a' || sorted[0].ingredient_b !== 'b') {
    throw new Error('expected serum+moisturizer pair first (higher minimum role than treatment+cleanser)');
  }
});

test('D5: shadow logger does not throw when env unset', () => {
  buildRoutineReasoningPayload({
    db,
    slots: [{ time: 'pm', ingredient_ids: [ID.glycerin] }],
    userMessage: 'x',
  });
});

section('H — batch 4 (D2 read / D4 / D5 diff / B5 / C3–C5)');

test('D2: getRoutinePostHookSnapshot returns null when no snapshot', () => {
  const s = getRoutinePostHookSnapshot('no-such-session-meta-xyz');
  if (s != null) throw new Error('expected null');
});

test('D4: parseRoutineReplyJsonFromLlmText handles fenced JSON', () => {
  const raw = '```json\n{"overall":"safe","conflicts":[],"safe_to_combine":[],"narrative":"ok","cited_chunk_ids":[],"reason_codes":[],"sensitive_note":null,"contraindication_warnings":[]}\n```';
  const o = parseRoutineReplyJsonFromLlmText(raw);
  if (!o || o.overall !== 'safe') throw new Error('parse fence');
});

test('D4: validateExternalLlmRoutineReply rejects garbage', () => {
  const v = validateExternalLlmRoutineReply('not json {', { sessionId: 't' });
  if (v.valid) throw new Error('expected invalid');
});

test('D5: legacy RAG merge uses same DB as orchestrator when db passed', () => {
  const v = verdict([ID.retinol, ID.lacticAcid]);
  const unified = retriever.getChunksForVerdict(v).chunks.length;
  const legacy = getChunksForRoutineVerdict(v, db).length;
  if (legacy < 1) throw new Error('expected legacy rows');
  if (unified < legacy) throw new Error('unified should include at least as much as legacy-only path');
});

test('B5: buildSystemPrompt includes product_id and sku on chunk tags', () => {
  const v = verdict([ID.glycerin]);
  const bundle = chunks(v);
  bundle.chunks = [
    {
      id: 'test-sku-chunk',
      chunk_source_tier: 'knowledge_sku',
      evidence_level: 'established',
      text: 'Product-specific note.',
      product_id: 'doclittle_demo_vitc_serum',
      sku: 'SKU-DEMO-VITC-001',
    },
  ];
  const prompt = buildSystemPrompt(v, bundle, defaultSession());
  if (!prompt.includes('product_id="doclittle_demo_vitc_serum"')) throw new Error('missing product_id attr');
  if (!prompt.includes('sku="SKU-DEMO-VITC-001"')) throw new Error('missing sku attr');
});

test('C3: splitTextForEmbedding produces multiple windows', () => {
  const long = 'word '.repeat(500);
  const parts = splitTextForEmbedding(long, { maxChars: 80, overlap: 10 });
  if (parts.length < 2) throw new Error('expected multiple chunks');
});

test('C4/C5: embedTexts returns placeholder nulls', () => {
  return embedTexts(['a', 'b']).then((rows) => {
    if (rows.length !== 2 || rows[0] != null) throw new Error('stub shape');
  });
});

test('vector stub: pinecone backend still returns empty hits', async () => {
  const prev = process.env.VECTOR_SEARCH_BACKEND;
  process.env.VECTOR_SEARCH_BACKEND = 'pinecone';
  try {
    const out = await createVectorRetrieverStub().search('query');
    if (!Array.isArray(out) || out.length !== 0) throw new Error('pinecone stub empty');
  } finally {
    if (prev === undefined) delete process.env.VECTOR_SEARCH_BACKEND;
    else process.env.VECTOR_SEARCH_BACKEND = prev;
  }
});

section('I — Epic B (B1–B6 SKU corpus, tiers, citations)');

const { createProductSkuCatalog } = require('../services/product-sku-catalog');

test('B1/B2: product_sku_catalog upsert resolves SKUs by product_id', () => {
  const cat = createProductSkuCatalog(db);
  if (!cat.hasTable) throw new Error('catalog table missing');
  cat.upsertRow({
    sku: 'eval-test-sku-1',
    product_id: 'eval_prod_b12',
    brand: 'Eval',
    display_name: 'Test Serum',
    formulation_tags: ['fragrance_free'],
    source: 'eval',
  });
  const skus = cat.listSkusByProductIds(['eval_prod_b12']);
  if (!skus.includes('eval-test-sku-1')) throw new Error('listSkusByProductIds');
});

test('B4: retriever ranks knowledge_sku before knowledge_pair for same verdict', () => {
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [ID.ascorbicAcid, ID.niacinamide] },
  ]);
  const b = retriever.getChunksForVerdict(v, { productIds: ['doclittle_demo_vitc_serum'] });
  if (!b.chunks.length) throw new Error('expected chunks');
  const first = b.chunks[0];
  if (first.chunk_source_tier !== 'knowledge_sku') {
    throw new Error(`expected knowledge_sku first, got ${first.chunk_source_tier}`);
  }
  if (first.id !== 'sku-seed-demo-vitc-mono-001') {
    throw new Error(`expected demo SKU monograph first, got ${first.id}`);
  }
});

test('B5/B6: composeLocal cites SKU-scoped chunk when routine product matches', () => {
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [ID.ascorbicAcid, ID.niacinamide] },
  ]);
  const b = retriever.getChunksForVerdict(v, { productIds: ['doclittle_demo_vitc_serum'] });
  const session = defaultSession({
    current_routine: [
      {
        time: 'am',
        products: [
          {
            product_id: 'doclittle_demo_vitc_serum',
            name: 'Demo C',
            ingredient_ids: [ID.ascorbicAcid, ID.niacinamide],
          },
        ],
      },
    ],
  });
  const reply = compose(v, b, session);
  const c0 = reply.conflicts[0];
  if (!c0.citation_ids.includes('sku-seed-demo-vitc-mono-001')) {
    throw new Error(`expected SKU seed in citations, got ${c0.citation_ids}`);
  }
});

test('B5: validateReply rejects reply that omits required SKU citation', () => {
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [ID.ascorbicAcid, ID.niacinamide] },
  ]);
  const b = retriever.getChunksForVerdict(v, { productIds: ['doclittle_demo_vitc_serum'] });
  const session = defaultSession({
    current_routine: [
      {
        time: 'am',
        products: [
          {
            product_id: 'doclittle_demo_vitc_serum',
            name: 'Demo C',
            ingredient_ids: [ID.ascorbicAcid, ID.niacinamide],
          },
        ],
      },
    ],
  });
  const good = compose(v, b, session);
  const bad = JSON.parse(JSON.stringify(good));
  bad.conflicts[0].citation_ids = ['nia-vitc-contested-001'];
  const val = validateReply(bad, { chunkBundle: b, verdict: v, session });
  if (val.valid) throw new Error('expected validation failure for missing SKU citation');
});

test('B6: skuChunkSupportsConflict links mono SKU chunk to pair verdict', () => {
  const ch = {
    id: 'mono',
    chunk_source_tier: 'knowledge_sku',
    product_id: 'doclittle_demo_vitc_serum',
    ingredient_a: 'cosing:ascorbic acid',
    ingredient_b: null,
  };
  const gc = { ingredient_a: 'cosing:niacinamide', ingredient_b: 'cosing:ascorbic acid' };
  if (!skuChunkSupportsConflict(ch, gc)) throw new Error('expected mono to support nia+vitc conflict');
});

section('J — Epic C/D (vector path, index meta, shadow metrics)');

test('C6: vector-index-ops records sync stats', () => {
  recordVectorSyncStats(db, { vectors_upserted: 3, test: true });
  const m = getVectorIndexMeta(db, 'vector_index:last_sync');
  if (!m || m.vectors_upserted !== 3) throw new Error('vector meta');
});

test('C1: createVectorRetriever falls back to stub when Pinecone not configured', async () => {
  const prev = process.env.VECTOR_SEARCH_BACKEND;
  process.env.VECTOR_SEARCH_BACKEND = 'pinecone';
  delete process.env.PINECONE_API_KEY;
  try {
    const vr = createVectorRetriever();
    const hits = await vr.search('niacinamide', { limit: 3 });
    if (!Array.isArray(hits)) throw new Error('hits');
  } finally {
    if (prev === undefined) delete process.env.VECTOR_SEARCH_BACKEND;
    else process.env.VECTOR_SEARCH_BACKEND = prev;
  }
});

test('D5: ROUTINE_REASONING_SHADOW_METRICS logs without throw', () => {
  const prev = process.env.ROUTINE_REASONING_SHADOW_METRICS;
  process.env.ROUTINE_REASONING_SHADOW_METRICS = '1';
  try {
    buildRoutineReasoningPayload({
      db,
      slots: [{ time: 'pm', ingredient_ids: [ID.glycerin] }],
      userMessage: 'hi',
    });
  } finally {
    if (prev === undefined) delete process.env.ROUTINE_REASONING_SHADOW_METRICS;
    else process.env.ROUTINE_REASONING_SHADOW_METRICS = prev;
  }
});

test('B3: scoped pair row retrieved when product_id matches (formulation-specific)', () => {
  try {
    db.prepare(
      `
      INSERT OR REPLACE INTO knowledge_chunks
        (id, ingredient_a, ingredient_b, reason_codes, text, source, evidence_level, product_id, sku)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      'eval-sku-pair-bp-vitc',
      'cosing:benzoyl peroxide',
      'cosing:ascorbic acid',
      '["oxidation_conflict","sku_scoped_pair"]',
      'Formulation-specific note: this SKU stacks BP with vitamin C in a tested protocol.',
      'eval',
      'probable',
      'doclittle_demo_vitc_serum',
      'SKU-DEMO-VITC-001',
    );
  } catch (e) {
    throw new Error(`insert sku pair: ${e.message}`);
  }
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [ID.benzylPeroxide, ID.ascorbicAcid] },
  ]);
  const b = retriever.getChunksForVerdict(v, { productIds: ['doclittle_demo_vitc_serum'] });
  const hasPair = b.chunks.some((c) => c.id === 'eval-sku-pair-bp-vitc');
  if (!hasPair) throw new Error('expected SKU-scoped pair chunk in bundle');
  if (b.chunks[0].chunk_source_tier !== 'knowledge_sku') {
    throw new Error('SKU tier should sort to top');
  }
});

console.log(`\n${'═'.repeat(66)}`);
console.log(`  Results: ${_passed} passed, ${_failed} failed`);
if (_failures.length) {
  console.log('\n  Failures:');
  _failures.forEach(({ label, message }) => {
    console.log(`    ✗  ${label}`);
    console.log(`         ${message}`);
  });
  process.exit(1);
}

db.close();
