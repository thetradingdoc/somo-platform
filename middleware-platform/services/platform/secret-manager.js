'use strict';

const crypto = require('crypto');
const db = require('../../database');

const PROVIDER = String(process.env.SECRET_PROVIDER || 'env').toLowerCase(); // env|gcp_sm|azure_kv|vault

function maskSecretName(name) {
  const s = String(name || 'unknown');
  if (s.length <= 6) return s;
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
}

function recordAccess(secretName, result, source, context = {}) {
  try {
    db.insertSecretAccessAudit({
      secret_name: secretName,
      consumer: context.consumer || null,
      access_context: context.purpose || null,
      result,
      source: source || PROVIDER,
      metadata: {
        provider: PROVIDER,
        secret_name_masked: maskSecretName(secretName),
        correlation_id: context.correlation_id || null
      }
    });
  } catch (_) {}
}

function getSecret(secretName, context = {}) {
  const name = String(secretName || '').trim();
  if (!name) {
    recordAccess('unknown', 'error', PROVIDER, context);
    throw new Error('secret_name_required');
  }

  const getEnv = () => process.env[name] || null;

  const getGcpSecretManager = async () => {
    const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    const token = process.env.GCP_SECRET_MANAGER_BEARER_TOKEN || process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    if (!projectId || !token) return null;
    const secretRef = process.env[`GCP_SECRET_REF_${name}`] || name;
    const version = process.env[`GCP_SECRET_VERSION_${name}`] || 'latest';
    const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(secretRef)}/versions/${encodeURIComponent(version)}:access`;
    const r = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const b64 = j?.payload?.data;
    if (!b64) return null;
    return Buffer.from(String(b64), 'base64').toString('utf8');
  };

  const getAzureKeyVault = async () => {
    const vaultUrl = process.env.AZURE_KEY_VAULT_URL;
    const token = process.env.AZURE_KEY_VAULT_BEARER_TOKEN;
    if (!vaultUrl || !token) return null;
    const secretRef = process.env[`AZURE_KV_SECRET_REF_${name}`] || name;
    const url = `${String(vaultUrl).replace(/\/$/, '')}/secrets/${encodeURIComponent(secretRef)}?api-version=7.4`;
    const r = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.value ? String(j.value) : null;
  };

  const getVault = async () => {
    const vaultAddr = process.env.VAULT_ADDR;
    const token = process.env.VAULT_TOKEN;
    if (!vaultAddr || !token) return null;
    const secretRef = process.env[`VAULT_SECRET_REF_${name}`] || name;
    const path = process.env.VAULT_KV_PATH || 'secret/data';
    const url = `${String(vaultAddr).replace(/\/$/, '')}/v1/${path}/${encodeURIComponent(secretRef)}`;
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'X-Vault-Token': token, Accept: 'application/json' }
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const data = j?.data?.data || j?.data || null;
    if (!data || typeof data !== 'object') return null;
    if (data.value != null) return String(data.value);
    if (data[name] != null) return String(data[name]);
    return null;
  };

  try {
    if (PROVIDER === 'env') {
      const value = getEnv();
      if (!value) {
        recordAccess(name, 'missing', 'env', context);
        return null;
      }
      recordAccess(name, 'allowed', 'env', context);
      return value;
    }

    // For async provider fetches in a sync API, use env fallback first then lazy network call disabled.
    // Runtime services should inject managed secrets into env or provide bearer token sidecar refresh.
    const envFallback = getEnv();
    if (envFallback) {
      recordAccess(name, 'allowed', `${PROVIDER}:env_fallback`, context);
      return envFallback;
    }
    recordAccess(name, 'missing', PROVIDER, context);
    return null;
  } catch (_) {
    recordAccess(name, 'error', PROVIDER, context);
    return null;
  }
}

function registerRotationPolicy({
  secret_name,
  owner,
  rotation_interval_days = 90,
  emergency_runbook_url = null,
  custody_notes = null
}) {
  if (!secret_name) throw new Error('secret_name_required');
  const now = new Date();
  const next = new Date(now.getTime() + Number(rotation_interval_days || 90) * 24 * 60 * 60 * 1000);
  return db.upsertSecretRotationRegistry({
    secret_name,
    owner: owner || null,
    rotation_interval_days: Number(rotation_interval_days || 90),
    last_rotated_at: now.toISOString(),
    next_rotation_due_at: next.toISOString(),
    emergency_runbook_url,
    custody_notes,
    metadata: { registered_by: 'secret-manager' }
  });
}

function markSecretRotated(secret_name, context = {}) {
  if (!secret_name) throw new Error('secret_name_required');
  const existing = db
    .listSecretRotationRegistry({ limit: 500 })
    .find((r) => String(r.secret_name || '') === String(secret_name));
  const interval = Number(existing?.rotation_interval_days || 90);
  const now = new Date();
  const next = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);
  return db.upsertSecretRotationRegistry({
    secret_name,
    owner: existing?.owner || null,
    rotation_interval_days: interval,
    last_rotated_at: now.toISOString(),
    next_rotation_due_at: next.toISOString(),
    emergency_runbook_url: existing?.emergency_runbook_url || null,
    custody_notes: existing?.custody_notes || null,
    metadata: {
      ...(existing?.metadata_json ? (() => {
        try { return JSON.parse(existing.metadata_json); } catch (_) { return {}; }
      })() : {}),
      last_rotated_by: context.actor || null
    }
  });
}

function listAbnormalSecretAccess({ limit = 100 } = {}) {
  const rows = db.listSecretAccessAudit({ limit: Math.max(1, Math.min(500, Number(limit) || 100)) });
  const grouped = new Map();
  for (const row of rows) {
    const k = `${row.secret_name || 'unknown'}:${row.result || 'unknown'}`;
    grouped.set(k, (grouped.get(k) || 0) + 1);
  }
  const abnormal = [];
  for (const [k, count] of grouped.entries()) {
    const [secret_name, result] = k.split(':');
    if (result === 'missing' || result === 'denied' || result === 'error') {
      abnormal.push({ secret_name, result, count, severity: count >= 5 ? 'high' : 'medium' });
    }
  }
  abnormal.sort((a, b) => b.count - a.count);
  return abnormal;
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex');
}

module.exports = {
  PROVIDER,
  getSecret,
  registerRotationPolicy,
  markSecretRotated,
  listAbnormalSecretAccess,
  hashToken
};

