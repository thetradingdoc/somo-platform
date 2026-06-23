// Simple in-memory metrics (can be replaced by Prometheus later)
const counters = Object.create(null);
const gauges = Object.create(null);

function increment(name, value = 1) {
  counters[name] = (counters[name] || 0) + value;
}

function gauge(name, value) {
  if (!Number.isFinite(value)) return;
  gauges[name] = value;
}

function getAll() {
  return { counters: { ...counters }, gauges: { ...gauges } };
}

module.exports = { increment, gauge, getAll };


