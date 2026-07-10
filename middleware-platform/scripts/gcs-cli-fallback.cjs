'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function gcloudBinDirs() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return [
    '/opt/homebrew/share/google-cloud-sdk/bin',
    '/opt/homebrew/bin',
    '/usr/local/google-cloud-sdk/bin',
    '/usr/local/bin',
    path.join(home, 'google-cloud-sdk', 'bin')
  ].filter((d) => d && fs.existsSync(d));
}

function pathWithGcloud() {
  const key = process.platform === 'win32' ? 'Path' : 'PATH';
  const parts = [...gcloudBinDirs(), ...(process.env[key] || '').split(path.delimiter)];
  return [...new Set(parts.filter(Boolean))].join(path.delimiter);
}

function gcsEnv() {
  return { ...process.env, PATH: pathWithGcloud() };
}

/**
 * Copy to/from GCS using gcloud storage (preferred) or gsutil.
 */
function gcsCp(src, dest) {
  const env = gcsEnv();
  const attempts = [
    `gcloud storage cp "${src}" "${dest}"`,
    `gsutil cp "${src}" "${dest}"`
  ];
  let lastErr;
  for (const cmd of attempts) {
    try {
      execSync(cmd, { stdio: 'inherit', encoding: 'utf8', env });
      return { ok: true, cmd };
    } catch (e) {
      lastErr = e;
    }
  }
  const hint = gcloudBinDirs().length
    ? ''
    : ' — add Google Cloud SDK to PATH or run gcloud auth login';
  throw lastErr || new Error(`gcs copy failed: ${src} -> ${dest}${hint}`);
}

module.exports = { gcsCp, pathWithGcloud, gcloudBinDirs };
