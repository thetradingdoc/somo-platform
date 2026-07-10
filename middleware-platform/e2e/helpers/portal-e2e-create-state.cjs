'use strict';

const fs = require('fs');
const path = require('path');
const { STATE_FILE, RESULTS_DIR, log } = require('./portal-e2e-config.cjs');

const VALID_STATES = new Set([
  'not_started',
  'signup_complete',
  'voice_setup_1',
  'voice_setup_2',
  'voice_setup_3',
  'voice_setup_4',
  'voice_setup_5',
  'voice_setup_6',
  'voice_setup_7',
  'did_bind_pending',
  'complete',
  'failed'
]);

function ensureDir() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function defaultState() {
  return {
    state: 'not_started',
    customer_id: null,
    email: null,
    practice_name: null,
    updated_at: new Date().toISOString(),
    history: []
  };
}

function loadState() {
  ensureDir();
  if (!fs.existsSync(STATE_FILE)) return defaultState();
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!VALID_STATES.has(raw.state)) raw.state = 'failed';
    return { ...defaultState(), ...raw };
  } catch {
    return defaultState();
  }
}

function saveState(patch, note) {
  const prev = loadState();
  const next = {
    ...prev,
    ...patch,
    updated_at: new Date().toISOString(),
    history: [
      ...(prev.history || []),
      { at: new Date().toISOString(), from: prev.state, to: patch.state || prev.state, note: note || null }
    ].slice(-50)
  };
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  log(`create-state: ${prev.state} → ${next.state}${note ? ` (${note})` : ''}`);
  return next;
}

function assertModeAllowed(mode, { forceRollback = false } = {}) {
  const st = loadState();
  if (forceRollback) {
    log('create-state: force rollback requested');
    return { ok: true, state: st };
  }
  if (mode === 'create' && st.state === 'complete') {
    return {
      ok: false,
      error: `Somo create blocked: state=complete (customer_id=${st.customer_id}). Use PW_MODE=reuse or PW_FORCE_ROLLBACK=1 with approval.`
    };
  }
  if (mode === 'create' && !['not_started', 'failed'].includes(st.state)) {
    return {
      ok: false,
      error: `Somo create blocked: partial progress state=${st.state}. Use PW_MODE=resume or PW_FORCE_ROLLBACK=1.`
    };
  }
  if (mode === 'resume' && !['signup_complete', 'did_bind_pending', 'failed'].includes(st.state) && !String(st.state).startsWith('voice_setup_')) {
    return {
      ok: false,
      error: `Resume not allowed from state=${st.state}. Use create (not_started) or reuse (complete).`
    };
  }
  if (mode === 'reuse' && st.state !== 'complete') {
    return {
      ok: false,
      error: `Reuse blocked: Somo not complete (state=${st.state}). Finish create/resume first.`
    };
  }
  return { ok: true, state: st };
}

function resetState(reason) {
  ensureDir();
  const blank = defaultState();
  blank.history = [{ at: new Date().toISOString(), from: loadState().state, to: 'not_started', note: reason || 'rollback' }];
  fs.writeFileSync(STATE_FILE, JSON.stringify(blank, null, 2));
  log(`create-state: reset → not_started (${reason || 'rollback'})`);
  return blank;
}

function voiceSetupState(step) {
  const n = Math.max(1, Math.min(7, Number(step) || 1));
  return `voice_setup_${n}`;
}

module.exports = {
  loadState,
  saveState,
  assertModeAllowed,
  resetState,
  voiceSetupState,
  VALID_STATES,
  STATE_FILE
};
