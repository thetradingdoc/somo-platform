#!/usr/bin/env node
'use strict';

/**
 * Verify voice Redis connectivity (staging/prod sign-off helper).
 *
 * Usage:
 *   REDIS_URL=redis://... node scripts/verify-voice-redis.cjs
 *   REDIS_URL=redis://... VOICE_RATE_LIMIT_BACKEND=redis node scripts/verify-voice-redis.cjs --fork-test
 */
process.chdir(require('path').join(__dirname, '..'));

const { fork } = require('child_process');
const voiceRedis = require('../utils/voice-redis-client');

async function main() {
  const forkTest = process.argv.includes('--fork-test');
  process.env.VOICE_RATE_LIMIT_BACKEND = 'redis';

  const ping = await voiceRedis.ping();
  if (!ping.ok) {
    console.error('FAIL voice Redis ping:', ping.error || 'not ok');
    process.exit(1);
  }
  console.log(`OK voice Redis ping latencyMs=${ping.latencyMs}`);

  if (forkTest) {
    await new Promise((resolve, reject) => {
      const childPath = require('path').join(__dirname, '_voice-rate-limit-child.cjs');
      const child = fork(childPath, [], {
        silent: true,
        env: { ...process.env, VOICE_RATE_LIMIT_BACKEND: 'redis' }
      });
      let out = '';
      child.stdout.on('data', (d) => {
        out += d.toString();
      });
      child.on('exit', async (code) => {
        if (code !== 0) {
          reject(new Error(`child exit ${code}`));
          return;
        }
        const parsed = JSON.parse(out.trim().split('\n').pop());
        const { checkAsync } = require('../utils/clinic-rate-limiter');
        const parentCheck = await checkAsync('shared-tenant-key-cross-process', 30);
        if (parentCheck.allowed) {
          reject(new Error('parent should be blocked after child exhausted budget'));
          return;
        }
        console.log(`OK voice Redis fork test shared budget (child=${parsed.processAllowedCount})`);
        resolve();
      });
    });
  }

  await voiceRedis.closeClient();
  console.log('OK verify-voice-redis');
}

main().catch((err) => {
  console.error('FAIL verify-voice-redis:', err.message);
  process.exit(1);
});
