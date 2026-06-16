'use strict';

const { execSync } = require('child_process');

/**
 * Copy to/from GCS using gcloud storage (preferred) or gsutil.
 */
function gcsCp(src, dest) {
  const attempts = [
    `gcloud storage cp "${src}" "${dest}"`,
    `gsutil cp "${src}" "${dest}"`
  ];
  let lastErr;
  for (const cmd of attempts) {
    try {
      execSync(cmd, { stdio: 'inherit', encoding: 'utf8' });
      return { ok: true, cmd };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`gcs copy failed: ${src} -> ${dest}`);
}

module.exports = { gcsCp };
