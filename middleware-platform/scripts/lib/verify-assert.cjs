'use strict';

function assert(name, ok, actual, expected) {
  return { name, pass: !!ok, actual, expected };
}

function parseJson(s) {
  try {
    return JSON.parse(s || '{}');
  } catch (_) {
    return {};
  }
}

function summarizeChecks(checks, meta = {}) {
  const failed = checks.filter((c) => !c.pass);
  return {
    ...meta,
    checks,
    success: failed.length === 0,
    failed: failed.map((c) => c.name)
  };
}

function printChecksAndExit(summary, opts = {}) {
  const exitFail = opts.exitFail != null ? opts.exitFail : 2;
  if (opts.jsonOut) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const c of summary.checks || []) {
      console.log(
        `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`,
        c.pass ? '' : JSON.stringify({ actual: c.actual, expected: c.expected })
      );
    }
    console.log(JSON.stringify({ success: summary.success, failed: summary.failed }, null, 2));
  }
  process.exit(summary.success ? 0 : exitFail);
}

module.exports = { assert, parseJson, summarizeChecks, printChecksAndExit };
