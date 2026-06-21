'use strict';

function parseVerifyArgs(argv = process.argv.slice(2)) {
  let sessionId = process.env.SESSION_ID || process.env.CALL_ID || '';
  let scenario = process.env.TERMINAL_SCENARIO || null;
  let jsonOut = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--session_id=')) {
      sessionId = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--scenario=')) {
      scenario = arg.split('=').slice(1).join('=');
    } else if ((arg === '--session' || arg === '--call') && argv[i + 1]) {
      sessionId = argv[++i];
    } else if (arg === '--json') {
      jsonOut = true;
    } else if (!arg.startsWith('--') && !sessionId) {
      sessionId = arg;
    }
  }

  return {
    sessionId: String(sessionId || '').trim(),
    scenario: scenario ? String(scenario).trim() : null,
    jsonOut
  };
}

function requireSessionId(usage, argv) {
  const { sessionId } = parseVerifyArgs(argv);
  if (!sessionId) {
    console.error(`Usage: SESSION_ID=<call_id> DB_PATH=<db> node ${usage}`);
    process.exit(2);
  }
  return sessionId;
}

module.exports = { parseVerifyArgs, requireSessionId };
