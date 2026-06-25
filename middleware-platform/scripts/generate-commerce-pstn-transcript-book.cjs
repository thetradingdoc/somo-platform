#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const FIXTURE = path.join(__dirname, '../tests/fixtures/commerce-pstn-replay-100.json');
const OUT = path.join(__dirname, '../../docs/qa/commerce-pstn-replay-100-TRANSCRIPT_BOOK.md');

function fmtTool(turn) {
  if (!turn.tool_call) return '';
  const args = turn.tool_call.args ? ` ${JSON.stringify(turn.tool_call.args)}` : '';
  return `\n  > **tool:** \`${turn.tool_call.name}\`${args}`;
}

function fmtTurn(turn) {
  const speaker = turn.speaker === 'agent' ? '**Kelly**' : '**Caller**';
  const asr =
    turn.speaker === 'caller' && turn.asr
      ? ` _(asr: ${turn.asr.noise}, ${turn.asr.confidence})_`
      : '';
  return `${turn.seq}. ${speaker}${asr}: ${turn.text}${fmtTool(turn)}`;
}

function renderCall(call) {
  const meta = call.call_metadata || {};
  const lines = [
    `### ${call.id} — ${call.title}`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Channel | ${call.channel} |`,
    `| Direction | ${meta.direction || '—'} |`,
    `| Locale | ${meta.locale || '—'} |`,
    `| Functions | ${(call.functions_tested || []).join(', ')} |`,
    `| Turns | ${call.turns.length} |`,
    ''
  ];
  if (call.assertions?.length) lines.push(`**Assertions:** ${call.assertions.join(', ')}`, '');
  lines.push('```', ...call.turns.map((t) => {
    const tool = t.tool_call ? ` [tool:${t.tool_call.name}]` : '';
    return `${String(t.seq).padStart(2, '0')} ${t.speaker.toUpperCase()}: ${t.text}${tool}`;
  }), '```', '');
  return lines.join('\n');
}

function main() {
  const pack = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const calls = pack.calls || [];

  const blocks = [
    ['Block 1: Voice supplement purchase', 'PSTN-001', 'PSTN-015'],
    ['Block 2: Chat supplement purchase', 'PSTN-016', 'PSTN-030'],
    ['Block 3: Voice appointment booking', 'PSTN-031', 'PSTN-048'],
    ['Block 4: Cancel / reschedule / outbound', 'PSTN-049', 'PSTN-060'],
    ['Block 5: Appointment payments', 'PSTN-061', 'PSTN-068'],
    ['Block 6: Complaints / vent / handoff', 'PSTN-069', 'PSTN-080'],
    ['Block 7: Multi-intent / edge / capstone', 'PSTN-081', 'PSTN-100']
  ];

  const byId = Object.fromEntries(calls.map((c) => [c.id, c]));
  const parts = [
    '# Commerce PSTN Replay 100 — Transcript Book',
    '',
    `> Generated from \`commerce-pstn-replay-100.json\` at ${pack.generated_at || new Date().toISOString()}`,
    '',
    `**${pack.stats?.total || calls.length} calls** — ${pack.stats?.voice || '—'} voice, ${pack.stats?.chat || '—'} chat`,
    '',
    'Human-readable QA sign-off artifact. Replay harness feeds **caller** lines sequentially; agent lines are golden expected outputs.',
    '',
    '---',
    ''
  ];

  for (const [title, start, end] of blocks) {
    parts.push(`## ${title}`, '');
    const startN = parseInt(start.split('-')[1], 10);
    const endN = parseInt(end.split('-')[1], 10);
    for (let n = startN; n <= endN; n += 1) {
      const id = `PSTN-${String(n).padStart(3, '0')}`;
      const call = byId[id];
      if (call) parts.push(renderCall(call));
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, parts.join('\n'));
  console.log(`Wrote ${OUT} (${calls.length} calls)`);
}

main();
