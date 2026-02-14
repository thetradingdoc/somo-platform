/**
 * Circuit Breaker (Section 2.1 - Middleware Brain Improvements)
 *
 * Per-service circuit breaker: open after N failures in window; half-open to probe.
 * Tracks trips and fallback invocations for metrics.
 */

const breakers = new Map();
const metrics = { trips: 0, fallbackInvocations: 0 };

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.windowMs = options.windowMs ?? 60000;
    this.resetTimeMs = options.resetTimeMs ?? 30000;
    this.failures = [];
    this.state = 'CLOSED';
    this.lastFailureTime = null;
  }

  async execute(fn, fallback) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeMs) {
        this.state = 'HALF_OPEN';
      } else {
        if (fallback) {
          metrics.fallbackInvocations++;
          return fallback();
        }
        throw new Error(`Circuit open: ${this.name}`);
      }
    }
    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failures = [];
      }
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  recordFailure() {
    const now = Date.now();
    this.failures.push(now);
    this.failures = this.failures.filter(t => now - t < this.windowMs);
    if (this.failures.length >= this.failureThreshold) {
      this.state = 'OPEN';
      this.lastFailureTime = now;
      metrics.trips++;
      console.warn(`⚠️  Circuit breaker OPEN: ${this.name} (${this.failures.length} failures in ${this.windowMs}ms)`);
    }
  }

  getState() {
    return this.state;
  }
}

function getOrCreate(name, options) {
  if (!breakers.has(name)) {
    breakers.set(name, new CircuitBreaker(name, options));
  }
  return breakers.get(name);
}

function getMetrics() {
  const states = {};
  for (const [name, b] of breakers) {
    states[name] = b.getState();
  }
  return {
    circuit_breaker_trips: metrics.trips,
    circuit_breaker_states: states,
    fallback_invocations: metrics.fallbackInvocations
  };
}

module.exports = {
  CircuitBreaker,
  getOrCreate,
  getMetrics,
  STEDI: 'stedi',
  ONE_UP_HEALTH: '1uphealth',
  GROQ: 'groq',
  FHIR: 'fhir',
  EPIC: 'epic'
};
