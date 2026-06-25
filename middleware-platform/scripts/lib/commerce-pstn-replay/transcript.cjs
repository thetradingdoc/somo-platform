'use strict';

const PAYMENT_TOOLS = new Set([
  'create_checkout',
  'prepare_commerce_checkout',
  'create_appointment_checkout',
  'request_patient_payment',
  'verify_checkout_code',
  'verify_commerce_code',
  'get_checkout_payment_status'
]);

function fmtToolLine(toolCall, toolsUsed) {
  if (toolCall?.name) return ` [tool:${toolCall.name}]`;
  if (toolsUsed?.length) return ` [tool:${toolsUsed.join(',')}]`;
  return '';
}

function formatTranscriptBlock(liveTranscript) {
  return liveTranscript.map((t) => {
    const seq = String(t.seq).padStart(2, '0');
    const speaker = t.speaker.toUpperCase();
    const tool = fmtToolLine(t.tool_call, t.toolsUsed);
    return `${seq} ${speaker}: ${t.text}${tool}`;
  });
}

function renderCallTranscript(call, liveTranscript, payment, opts = {}) {
  const meta = call.call_metadata || {};
  const lines = [
    `### ${call.callId || call.id} — ${call.title}`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Channel | ${call.channel} |`,
    `| Direction | ${meta.direction || '—'} |`,
    `| Locale | ${meta.locale || '—'} |`,
    `| Result | ${opts.pass ? 'PASS' : 'FAIL'} |`,
    `| Runtime | ${opts.runtime || '—'} |`
  ];
  if (opts.sessionId) lines.push(`| Session | \`${opts.sessionId}\` |`);
  lines.push('');

  if (opts.goldenTranscript?.length) {
    lines.push('#### Golden expected (script)', '', '```', ...formatTranscriptBlock(opts.goldenTranscript), '```', '');
  }

  if (liveTranscript?.length) {
    lines.push('#### Live conversation', '', '```', ...formatTranscriptBlock(liveTranscript), '```', '');
  }

  if (payment) {
    lines.push('#### Payment (like real call — link issued, customer pays separately)', '', '```');
    for (const [k, v] of Object.entries(payment)) {
      if (v != null && v !== '') lines.push(`${k}: ${v}`);
    }
    lines.push('```', '');
  }

  if (opts.turnFailures?.length) {
    lines.push('#### Turn failures', '');
    for (const f of opts.turnFailures) {
      lines.push(`- seq ${f.seq}: ${f.detail || 'reply/tool mismatch'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function printCallTranscriptToConsole(callId, liveTranscript, payment) {
  console.log('');
  console.log(`── ${callId} conversation ──`);
  for (const line of formatTranscriptBlock(liveTranscript)) {
    console.log(line);
  }
  if (payment) {
    console.log('── payment ──');
    for (const [k, v] of Object.entries(payment)) {
      if (v != null && v !== '') console.log(`  ${k}: ${v}`);
    }
  }
  console.log('');
}

function collectPaymentSummary(db, sessionId, runtime, call) {
  let conn = null;
  if (runtime === 'voice_commerce' || runtime === 'hybrid_booking_commerce') {
    try {
      const { getHandler } = require('./retell-commerce-replay.cjs');
      conn = getHandler(db).activeConnections.get(sessionId);
    } catch (_) {}
  }

  const checkoutId = conn?.lastCheckoutId || null;
  let voiceCheckout = null;
  if (checkoutId && db.db?.prepare) {
    try {
      voiceCheckout = db.db.prepare('SELECT * FROM voice_checkouts WHERE id = ?').get(checkoutId);
    } catch (_) {}
  }

  const sessions = db.getCheckoutSessionsByKellySessionId?.(sessionId) || [];
  const flowSession = sessions.length ? sessions[sessions.length - 1] : null;
  const fns = call.functions_tested || [];
  const hasPayment = fns.some((f) => PAYMENT_TOOLS.has(f));

  if (!hasPayment && !checkoutId && !flowSession) {
    return null;
  }

  const total =
    voiceCheckout?.total_amount != null
      ? voiceCheckout.total_amount
      : voiceCheckout?.amount != null
        ? voiceCheckout.amount
        : flowSession?.total_amount != null
          ? flowSession.total_amount
          : null;

  return {
    step: checkoutId || flowSession ? 'checkout_created_link_issued' : 'no_checkout_recorded',
    checkout_id: checkoutId || flowSession?.id || null,
    status: voiceCheckout?.status || flowSession?.status || 'pending',
    payment_method: voiceCheckout?.payment_method || 'link',
    total: total != null ? `$${Number(total).toFixed(2)}` : conn?.lastCheckoutId ? '(see checkout)' : null,
    customer_email: conn?.customerEmail || voiceCheckout?.customer_email || null,
    link_delivery: process.env.PSTN_REPLAY_COMMERCE === '1' ? 'replay_ok (SMTP skipped in dev)' : 'email/sms',
    customer_pays: 'via secure link after call ends (not executed in replay harness)'
  };
}

function goldenTranscriptFromCall(call) {
  return (call.turns || []).map((t) => ({
    seq: t.seq,
    speaker: t.speaker,
    text: t.text,
    tool_call: t.tool_call || null
  }));
}

function writeLiveTranscriptBook(results, opts, runId, repoRoot) {
  const fs = require('fs');
  const path = require('path');
  const d = new Date().toISOString();
  const outPath =
    opts.liveTranscriptBook ||
    path.join(repoRoot, 'docs/qa', `commerce-pstn-replay-LIVE-TRANSCRIPT-${runId.slice(0, 12)}.md`);

  const parts = [
    '# Commerce PSTN Replay 100 — Live Transcript Book',
    '',
    `> Run \`${runId}\` at ${d}`,
    '',
    `**${results.length} calls executed** — conversation then payment, as in production PSTN flow.`,
    '',
    'Each call: live agent replies after golden caller lines, then payment/checkout outcome.',
    '',
    '---',
    ''
  ];

  for (const r of results) {
    parts.push(
      renderCallTranscript(
        { id: r.callId, title: r.title, channel: r.channel, call_metadata: r.call_metadata },
        r.liveTranscript || [],
        r.payment,
        {
          pass: r.pass,
          runtime: r.runtime,
          sessionId: r.sessionId,
          goldenTranscript: r.goldenTurns ? goldenTranscriptFromCall({ turns: r.goldenTurns }) : null,
          turnFailures: (r.turnResults || []).filter((t) => t.pass === false)
        }
      )
    );
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, parts.join('\n'));
  return outPath;
}

module.exports = {
  formatTranscriptBlock,
  renderCallTranscript,
  printCallTranscriptToConsole,
  collectPaymentSummary,
  writeLiveTranscriptBook,
  goldenTranscriptFromCall,
  PAYMENT_TOOLS
};
