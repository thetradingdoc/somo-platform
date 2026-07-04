'use strict';

const { spawnSync } = require('child_process');

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function gcloudDescribe(options = {}) {
  const service = options.service || process.env.GCP_SERVICE || process.env.CLOUDRUN_SERVICE || 'somo-middleware';
  const region = options.region || process.env.GCP_REGION || process.env.GOOGLE_CLOUD_REGION || 'us-central1';
  const project = options.project || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
  const base = ['run', 'services', 'describe', service, '--region', region, '--format', 'json'];
  if (project) base.unshift('--project', project);
  return spawnSync('gcloud', base, { encoding: 'utf8' });
}

function envMapFromServiceJson(serviceJson) {
  const out = {};
  const containers = serviceJson?.spec?.template?.spec?.containers || [];
  for (const c of containers) {
    for (const e of c.env || []) {
      if (!e.name) continue;
      if (e.value != null) out[e.name] = e.value;
      else if (e.valueFrom?.secretKeyRef?.name) {
        out[e.name] = `(secret:${e.valueFrom.secretKeyRef.name})`;
      }
    }
  }
  return out;
}

function fetchCloudRunEnv(options = {}) {
  const which = spawnSync('which', ['gcloud'], { encoding: 'utf8' });
  if (which.status !== 0) {
    return { ok: false, error: 'gcloud not found', env: {} };
  }

  const r = gcloudDescribe(options);
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || 'gcloud describe failed').trim(), env: {} };
  }

  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch (e) {
    return { ok: false, error: `parse failed: ${e.message}`, env: {} };
  }

  const containers = json?.spec?.template?.spec?.containers || [];
  const image = containers[0]?.image || null;

  return {
    ok: true,
    env: envMapFromServiceJson(json),
    revision: json.status?.latestReadyRevisionName || null,
    image
  };
}

function isSecretRef(value) {
  return String(value || '').startsWith('(secret:');
}

function envValuePresent(value) {
  if (value == null) return false;
  const s = String(value).trim();
  return Boolean(s);
}

/** Merge live Cloud Run env over local for deploy gate checks. */
function mergeEnvForGates(localEnv = {}, cloudEnv = {}) {
  return { ...localEnv, ...cloudEnv };
}

module.exports = {
  truthy,
  gcloudDescribe,
  envMapFromServiceJson,
  fetchCloudRunEnv,
  isSecretRef,
  envValuePresent,
  mergeEnvForGates
};
