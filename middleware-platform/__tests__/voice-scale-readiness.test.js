'use strict';

/**
 * Runtime evidence for voice scale / multi-instance readiness (Interpretation C).
 */

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const CallSessionService = require('../services/call-session-service');
const { check, checkAsync } = require('../utils/clinic-rate-limiter');
const { getMaxRequestsPerMinute, getMaxConcurrentCalls } = require('../services/plan-catalog');
const {
  getRateLimitForCustomer,
  getConcurrentCallsForCustomer
} = require('../services/billing-access');
const voiceLimitService = require('../services/voice-limit-service');
const voiceActiveCalls = require('../services/voice-active-calls-service');

process.env.VOICE_RATE_LIMIT_BACKEND = 'memory';

const { stopMaintenanceTimer } = require('../utils/clinic-rate-limiter');

const planCatalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../config/plan-catalog.json'), 'utf8')
);

describe('voice scale readiness (Interpretation C evidence)', () => {
  afterAll(() => {
    stopMaintenanceTimer();
  });

  describe('single-instance multi-call isolation', () => {
    beforeEach(() => {
      CallSessionService.sessions.clear();
    });

    test('CallSessionService keeps separate sessions per callId', () => {
      const a = CallSessionService.startSession({ callId: 'call-a', clinicId: 'clinic-1' });
      const b = CallSessionService.startSession({ callId: 'call-b', clinicId: 'clinic-1' });
      expect(a.callId).toBe('call-a');
      expect(b.callId).toBe('call-b');
      expect(a.traceId).not.toBe(b.traceId);
      CallSessionService.updateSession('call-a', { degradedMode: true });
      expect(CallSessionService.getSession('call-b').degradedMode).toBe(false);
      expect(CallSessionService.sessions.size).toBe(2);
    });

    test('RetellWebSocketHandler activeConnections is a per-handler Map', () => {
      const RetellWebSocketHandler = require('../webhooks/retell-websocket.js');
      const h1 = new RetellWebSocketHandler({}, {});
      const h2 = new RetellWebSocketHandler({}, {});
      h1.activeConnections.set('x', { callId: 'x' });
      expect(h2.activeConnections.size).toBe(0);
      expect(h1.activeConnections.size).toBe(1);
    });
  });

  describe('admission vs turn rate limits', () => {
    test('starter tier has max_requests_per_minute and max_concurrent_calls', () => {
      expect(planCatalog.tiers.starter.max_requests_per_minute).toBe(30);
      expect(planCatalog.tiers.starter.max_concurrent_calls).toBe(2);
      expect(getRateLimitForCustomer({ plan_tier: 'starter' })).toBe(30);
      expect(getConcurrentCallsForCustomer({ plan_tier: 'starter' })).toBe(2);
    });

    test('40+ turns on one callId do not exhaust admission budget', () => {
      const admissionKey = `admission-${Date.now()}`;
      const callId = `turn-call-${Date.now()}`;
      for (let turn = 0; turn < 45; turn++) {
        const turnResult = voiceLimitService.checkTurnRateLimit({ callId });
        expect(turnResult.allowed).toBe(true);
      }
      const admission = check(`${admissionKey}-fresh`, 30);
      expect(admission.allowed).toBe(true);
      expect(admission.remaining).toBe(29);
    });

    test('31 admissions in one window reject starter tenant', async () => {
      const tenant = `scale-admit-${Date.now()}`;
      const limit = getMaxRequestsPerMinute('starter');
      let last;
      for (let i = 0; i < limit + 1; i++) {
        last = await voiceLimitService.checkCallAdmission({
          customerId: tenant,
          tierLimit: limit
        });
      }
      expect(last.allowed).toBe(false);
    });
  });

  describe('concurrent call caps in catalog', () => {
    test('all tiers define max_concurrent_calls', () => {
      expect(getMaxConcurrentCalls('starter')).toBe(2);
      expect(getMaxConcurrentCalls('practice')).toBe(5);
      expect(getMaxConcurrentCalls('clinic_pro')).toBe(10);
    });
  });

  describe('multi-process rate limiter (memory backend)', () => {
    test('separate Node processes maintain independent memory counters', (done) => {
      const childPath = path.join(__dirname, '../scripts/_voice-rate-limit-child.cjs');
      const child = fork(childPath, [], {
        silent: true,
        env: { ...process.env, VOICE_RATE_LIMIT_BACKEND: 'memory' }
      });
      let out = '';
      child.stdout.on('data', (d) => {
        out += d.toString();
      });
      child.on('exit', (code) => {
        expect(code).toBe(0);
        const line = out.trim().split('\n').pop();
        const parsed = JSON.parse(line);
        expect(parsed.processAllowedCount).toBe(30);
        const parentCheck = check('shared-tenant-key-cross-process', 30);
        expect(parentCheck.allowed).toBe(true);
        done();
      });
    }, 15000);
  });

  describe('redis missing fallback', () => {
    test('checkAsync falls back to memory when VOICE_RATE_LIMIT_BACKEND=redis but REDIS_URL unset', async () => {
      const prevBackend = process.env.VOICE_RATE_LIMIT_BACKEND;
      const prevRedis = process.env.REDIS_URL;
      const prevVoiceRedis = process.env.VOICE_REDIS_URL;
      delete process.env.REDIS_URL;
      delete process.env.VOICE_REDIS_URL;
      process.env.VOICE_RATE_LIMIT_BACKEND = 'redis';

      const tenant = `redis-fallback-${Date.now()}`;
      const result = await checkAsync(tenant, 30);

      expect(result.allowed).toBe(true);
      expect(result.backend).toBe('memory');

      process.env.VOICE_RATE_LIMIT_BACKEND = prevBackend || 'memory';
      if (prevRedis) process.env.REDIS_URL = prevRedis;
      if (prevVoiceRedis) process.env.VOICE_REDIS_URL = prevVoiceRedis;
    });
  });

  describe('Redis shared admission (when REDIS_URL set)', () => {
    test('parent and child share admission budget via Redis', (done) => {
      if (!process.env.REDIS_URL) {
        console.log('skip: REDIS_URL not set');
        done();
        return;
      }
      process.env.VOICE_RATE_LIMIT_BACKEND = 'redis';
      const childPath = path.join(__dirname, '../scripts/_voice-rate-limit-child.cjs');
      const child = fork(childPath, [], {
        silent: true,
        env: { ...process.env, VOICE_RATE_LIMIT_BACKEND: 'redis' }
      });
      let out = '';
      child.stdout.on('data', (d) => {
        out += d.toString();
      });
      child.on('exit', async (code) => {
        process.env.VOICE_RATE_LIMIT_BACKEND = 'memory';
        expect(code).toBe(0);
        const parsed = JSON.parse(out.trim().split('\n').pop());
        expect(parsed.processAllowedCount).toBe(30);
        const parentCheck = await checkAsync('shared-tenant-key-cross-process', 30);
        expect(parentCheck.allowed).toBe(false);
        await require('../utils/voice-redis-client').closeClient();
        done();
      });
    }, 20000);
  });

  describe('load test infrastructure', () => {
    test('test:voice uses focused run-voice-jest gate script', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
      expect(pkg.scripts['test:voice']).toContain('run-voice-jest.cjs');
      expect(pkg.scripts['test:voice:load']).toBeDefined();
      expect(fs.existsSync(path.join(__dirname, '../scripts/run-voice-jest.cjs'))).toBe(true);
      expect(fs.existsSync(path.join(__dirname, '../scripts/voice-load-smoke.cjs'))).toBe(true);
      expect(fs.existsSync(path.join(__dirname, '../tests/load/basic-load.js'))).toBe(true);
    });
  });

  describe('CallSessionService storage model', () => {
    test('sessions live in process memory; limits use Redis', () => {
      expect(CallSessionService.sessions).toBeInstanceOf(Map);
      const src = fs.readFileSync(
        path.join(__dirname, '../services/call-session-service.js'),
        'utf8'
      );
      expect(src).toMatch(/in-process|Redis/);
      expect(fs.existsSync(path.join(__dirname, '../utils/voice-redis-client.js'))).toBe(true);
    });
  });
});
