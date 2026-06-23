'use strict';

const db = require('../../database');

/**
 * Named DRI + backup for payment / reconciliation exception queues.
 * Env wins over DB row for ops bootstrap; optional weekly rotation from PAYMENT_EXCEPTION_OWNER_POOL.
 *
 * PAYMENT_EXCEPTION_DRI_PRIMARY — primary owner handle
 * PAYMENT_EXCEPTION_DRI_BACKUP — backup owner handle
 * PAYMENT_EXCEPTION_OWNER_POOL — comma-separated pool for rotation (optional)
 */

function parsePool(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function weekIndex() {
  return Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
}

function rotateFromPool(pool) {
  if (!pool.length) return { primary: null, backup: null };
  const w = weekIndex();
  const primary = pool[w % pool.length];
  const backup = pool.length > 1 ? pool[(w + 1) % pool.length] : null;
  return { primary, backup };
}

function getPaymentExceptionOwners() {
  const envPrimary = (process.env.PAYMENT_EXCEPTION_DRI_PRIMARY || '').trim() || null;
  const envBackup = (process.env.PAYMENT_EXCEPTION_DRI_BACKUP || '').trim() || null;
  const pool = parsePool(process.env.PAYMENT_EXCEPTION_OWNER_POOL || '');

  if (envPrimary || envBackup) {
    return {
      source: 'env',
      primary: envPrimary,
      backup: envBackup,
      pool
    };
  }

  let row = null;
  try {
    row = db.getPaymentExceptionQueueRoles && db.getPaymentExceptionQueueRoles('default');
  } catch (_) {}

  const dbPool = row && row.owner_pool ? parsePool(row.owner_pool) : [];
  const mergedPool = pool.length ? pool : dbPool;

  if (mergedPool.length) {
    const r = rotateFromPool(mergedPool);
    return {
      source: 'rotation',
      primary: r.primary || row?.dri || null,
      backup: r.backup || row?.backup || null,
      pool: mergedPool,
      rotation_week: weekIndex()
    };
  }

  return {
    source: 'database',
    primary: row?.dri || null,
    backup: row?.backup || null,
    pool: []
  };
}

module.exports = {
  getPaymentExceptionOwners,
  weekIndex,
  parsePool
};
