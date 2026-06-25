'use strict';

/**
 * Retell API helpers for Phase 1 live verify when GCS SQLite lacks kelly_call_events
 * (POSTGRES_PRIMARY / upload interval).
 */

async function retellFetch(path, body) {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error('RETELL_API_KEY required');
  const opts = {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  };
  if (body) {
    opts.method = 'POST';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`https://api.retellai.com/v2${path}`, opts);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Retell ${path} ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function getCall(callId) {
  return retellFetch(`/get-call/${callId}`);
}

async function listCalls(filter = {}, limit = 5) {
  const calls = await retellFetch('/list-calls', {
    filter_criteria: filter,
    limit,
    sort_order: 'descending'
  });
  return Array.isArray(calls) ? calls : [];
}

async function latestCallTo(toNumber) {
  const calls = await listCalls({ to_number: [toNumber] }, 1);
  return calls[0] || null;
}

async function latestCallFrom(fromNumber) {
  const calls = await listCalls({ from_number: [fromNumber] }, 1);
  return calls[0] || null;
}

function transcriptHasOpqrst(transcript) {
  return /what makes it better|when did this start|provocation|onset question|scale of zero to ten/i.test(
    String(transcript || '')
  );
}

function transcriptHasDemo(transcript) {
  return /Somo|practice|dental|qualify|signup|front desk/i.test(String(transcript || ''));
}

function transcriptHasBooking(transcript) {
  return /appointment|book|schedule|slot|time works|confirmed/i.test(String(transcript || ''));
}

function transcriptHasEscalation(transcript) {
  return /transfer|connect you|human|representative|escalat/i.test(String(transcript || ''));
}

module.exports = {
  getCall,
  listCalls,
  latestCallTo,
  latestCallFrom,
  transcriptHasOpqrst,
  transcriptHasDemo,
  transcriptHasBooking,
  transcriptHasEscalation
};
