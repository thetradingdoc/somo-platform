/**
 * Performance budgets (mvp-63)
 *
 * Lightweight check to prevent shipping huge static assets.
 * Intended for CI: fail if any critical file exceeds max bytes.
 */

const fs = require('fs');
const path = require('path');

const budgets = [
  { rel: 'unified-dashboard/assets/css/global.css', max: 300 * 1024 },
  { rel: 'unified-dashboard/assets/js/patient-api.js', max: 80 * 1024 },
  { rel: 'unified-dashboard/assets/js/patient-shell.js', max: 120 * 1024 }
];

function statBytes(p) {
  const abs = path.join(process.cwd(), p);
  if (!fs.existsSync(abs)) return null;
  return fs.statSync(abs).size;
}

let ok = true;
const results = budgets.map((b) => {
  const size = statBytes(b.rel);
  const pass = size == null ? true : size <= b.max;
  if (!pass) ok = false;
  return { file: b.rel, bytes: size, max_bytes: b.max, pass };
});

console.log(JSON.stringify({ success: ok, budgets: results }, null, 2));
process.exit(ok ? 0 : 1);

