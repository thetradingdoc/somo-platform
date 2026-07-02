'use strict';

const buckets = new Map();

function pilotRateLimit(kind, { windowMs = 60000, max = 30 } = {}) {
  return (req, res, next) => {
    if (process.env.PILOT_RATE_LIMIT_ENABLED === '0') return next();
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = `${kind}:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ success: false, error: 'rate_limit_exceeded', kind });
    }
    next();
  };
}

module.exports = { pilotRateLimit };
