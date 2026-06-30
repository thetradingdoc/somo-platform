'use strict';
/** Child helper: exhaust rate limit in isolated process for multi-replica test. */
process.env.VOICE_RATE_LIMIT_BACKEND = process.env.VOICE_RATE_LIMIT_BACKEND || 'memory';

const { check, checkAsync } = require('../utils/clinic-rate-limiter');

const key = 'shared-tenant-key-cross-process';
const limit = 30;
const useAsync = process.env.VOICE_RATE_LIMIT_BACKEND === 'redis';

async function run() {
  let allowed = 0;
  for (let i = 0; i < 35; i++) {
    const r = useAsync ? await checkAsync(key, limit) : check(key, limit);
    if (r.allowed) allowed += 1;
  }
  process.stdout.write(`${JSON.stringify({ processAllowedCount: allowed, backend: process.env.VOICE_RATE_LIMIT_BACKEND })}\n`);
  if (useAsync) {
    await require('../utils/voice-redis-client').closeClient();
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
