'use strict';

const fs = require('fs');
const path = require('path');
const { renderCallTranscript, goldenTranscriptFromCall } = require('./transcript.cjs');

function writeRunReport(results, opts, runId, repoRoot) {
  const passed = results.filter((r) => r.pass).length;
  const wave1Passed = results.filter((r) => r.wave1Pass).length;
  const acceptancePassed = results.filter((r) => r.acceptancePass).length;
  const lines = [
    '# Commerce PSTN Replay — Live Run Report',
    '',
    `**Run ID:** ${runId}`,
    `**Mode:** ${opts.dryRun ? 'dry-run (structural)' : opts.acceptance ? 'acceptance (wave1)' : 'live (Kelly)'}`,
    `**Calls executed:** ${results.length}`,
    `**Passed (strict):** ${passed} / ${results.length}`,
    `**Wave1 (tools + assertions):** ${wave1Passed} / ${results.length}`,
    ...(opts.acceptance
      ? [`**Acceptance:** ${acceptancePassed} / ${results.length}`, '']
      : []),
    '',
    'Strict pass = every caller turn matches golden agent reply + tool (when expected), all `functions_tested` complete, assertions satisfied.',
    'Wave1 pass = all `functions_tested` complete and all assertions satisfied (dialogue Jaccard may still fail).',
    '',
    '---',
    ''
  ];

  for (const r of results) {
    lines.push(
      renderCallTranscript(
        {
          id: r.callId,
          title: r.title,
          channel: r.channel,
          call_metadata: r.call_metadata
        },
        r.liveTranscript || [],
        r.payment,
        {
          pass: r.pass,
          wave1Pass: r.wave1Pass,
          acceptancePass: r.acceptancePass,
          runtime: r.runtime,
          sessionId: r.sessionId,
          goldenTranscript: r.goldenTurns ? goldenTranscriptFromCall({ turns: r.goldenTurns }) : null,
          turnFailures: (r.turnResults || []).filter((t) => t.pass === false)
        }
      )
    );

    if (r.assertionResults?.length) {
      lines.push('#### Assertions', '');
      for (const a of r.assertionResults) {
        lines.push(`- **${a.assertionId}:** ${a.pass ? 'PASS' : 'FAIL'} — ${a.detail}`);
      }
      lines.push('');
    }

    if (r.functionCheck && !r.functionCheck.pass) {
      lines.push(`#### Missing functions`, '', `${r.functionCheck.missing.join(', ')}`, '');
    }

    if (r.turnResults?.length) {
      lines.push(
        '#### Per-turn scoring',
        '',
        '| Seq | Pass | Similarity | Expected tool | Tools used |',
        '|-----|------|------------|---------------|------------|'
      );
      for (const t of r.turnResults) {
        if (t.speaker === 'caller' && t.detail === 'batched with next caller line') continue;
        lines.push(
          `| ${t.seq} | ${t.pass ? 'OK' : 'FAIL'} | ${t.similarity ?? '—'} | ${t.expectedTool ?? '—'} | ${(t.toolsUsed || []).join(', ') || '—'} |`
        );
      }
      lines.push('');
    }

    lines.push('---', '');
  }

  fs.mkdirSync(path.dirname(opts.report), { recursive: true });
  fs.writeFileSync(opts.report, lines.join('\n'));
  return opts.report;
}

module.exports = { writeRunReport };
