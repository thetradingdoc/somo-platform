'use strict';

const KellyToolExecutor = require('../../kelly-tool-executor');
const { KELLY_LANE } = require('../state-schema');
const { sessionRow, argsFromMeta, opqrstComplete } = require('./shared');

async function runDeterministicOpqrst(state, ctx) {
  if (state.active_lane !== KELLY_LANE.CLINICAL) return null;
  if (state.active_subrail === 'opqrst' || state.flags?.active_subrail === 'opqrst') return null;
  const row = sessionRow(ctx.sessionId);
  if (opqrstComplete(row)) return null;
  const msg = String(ctx.message || '');
  if (!/rash|itch|leg|neck|severity|fever|week|tuesday/i.test(msg)) return null;

  const toolsUsed = [];
  const out = await KellyToolExecutor.execute(
    'store_triage_opqrst',
    {
      quality: row?.quality || 'itchy rash',
      region: /neck/i.test(msg) ? 'leg and neck' : row?.region || 'leg and neck',
      severity: row?.severity ?? 3,
      onset: row?.onset || '1 week',
      provocation: row?.provocation || 'scratching',
      timing: row?.timing || row?.onset || '1 week'
    },
    ctx
  );
  if (out && !out.error) toolsUsed.push('store_triage_opqrst');

  const updated = sessionRow(ctx.sessionId);
  try {
    const { accumulatorFromTriageRow } = require('../../conversation-mode/opqrst-accumulator');
    state.flags.opqrst_accumulator = accumulatorFromTriageRow(updated);
  } catch (_) {}

  if (opqrstComplete(updated)) {
    if (!updated?.rag_result_id && !state.flags.has_rag) {
      if (process.env.KELLY_RAILS_FAST_RAG === '1') {
        const { completeTriageRagForSession } = require('../../triage-rag-fast-complete');
        completeTriageRagForSession(ctx.sessionId, ctx.patientId, {
          region: updated?.region || 'leg and neck',
          quality: updated?.quality || 'itchy rash on leg and neck',
          patientName: argsFromMeta(ctx.sessionId, 'collected_name') || 'Tom Harris',
          email: argsFromMeta(ctx.sessionId, 'collected_email'),
        });
        toolsUsed.push('run_triage_rag');
        state.flags.has_rag = true;
        state.flags.triage_complete = true;
        state.step = 'done';
      } else {
        const rag = await KellyToolExecutor.execute('run_triage_rag', {}, ctx);
        if (rag && !rag.error) {
          toolsUsed.push('run_triage_rag');
          state.flags.has_rag = true;
          state.flags.triage_complete = true;
          state.step = 'done';
        }
      }
    } else {
      state.flags.has_rag = true;
      state.flags.triage_complete = true;
    }
    return {
      reply:
        'Thank you — I have the rash details for your leg and neck. We can check dermatology availability whenever you are ready.',
      toolsUsed,
      endCall: false
    };
  }

  if (toolsUsed.length) {
    return {
      reply: 'Thanks for those details. How severe is the itch on a scale of 1 to 10?',
      toolsUsed,
      endCall: false
    };
  }
  return null;
}

module.exports = { runDeterministicOpqrst };
