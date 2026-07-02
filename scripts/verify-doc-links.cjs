#!/usr/bin/env node
'use strict';

/**
 * Doc hygiene gate — assert canonical doc links resolve and deleted checklists are not referenced.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');

function check(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);
  return ok;
}

function fileExists(rel) {
  return fs.existsSync(path.join(REPO, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

function extractMarkdownLinks(content) {
  const links = [];
  const re = /\[[^\]]+\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(content))) {
    let target = m[1].trim();
    if (target.startsWith('http') || target.startsWith('mailto:') || target.startsWith('#')) continue;
    if (target.startsWith('~')) continue;
    target = target.split('#')[0].split('?')[0];
    try {
      target = decodeURIComponent(target);
    } catch (_) {}
    if (!target || target.endsWith('.md') === false) continue;
    links.push(target);
  }
  return links;
}

function resolveLink(fromFile, link) {
  if (link.startsWith('/')) return path.join(REPO, link.slice(1));
  return path.normalize(path.join(path.dirname(path.join(REPO, fromFile)), link));
}

function main() {
  console.log('\n=== Doc hygiene gate ===\n');
  let pass = true;

  const deletedChecklists = [
    'docs/voice-agent/phase5-9-checklist.md',
    'docs/voice-agent/phase6-ops-checklist.md',
    'docs/voice-agent/phase7-8-checklist.md'
  ];

  for (const f of deletedChecklists) {
    pass = check(`deleted checklist not present: ${f}`, !fileExists(f)) && pass;
  }

  const required = [
    'docs/meta/CANONICAL_DOC_MAP.md',
    'docs/voice-agent/README.md',
    'docs/voice-agent/unblocked-phases-ops.md',
    'docs/architecture/LIVE.md',
    'docs/architecture/PMS_CONNECT_ARCHITECTURE.md',
    'docs/deployment/FRONT_DESK_PRODUCTION.md',
    'docs/deployment/PHASE0_DEPLOY_STATE.md',
    'docs/deployment/FRONT_DESK_DEPLOY_CHECKLIST.md'
  ];

  for (const f of required) {
    pass = check(`required doc exists: ${f}`, fileExists(f)) && pass;
  }

  const scanFiles = [
    'docs/README.md',
    'docs/meta/CANONICAL_DOC_MAP.md',
    'docs/voice-agent/README.md',
    'README.md'
  ];

  const missingLinks = [];
  for (const rel of scanFiles) {
    const content = read(rel);
    for (const link of extractMarkdownLinks(content)) {
      const resolved = resolveLink(rel, link);
      if (!fs.existsSync(resolved)) {
        missingLinks.push({ from: rel, link, resolved });
      }
    }
  }

  if (missingLinks.length) {
    pass = false;
    for (const m of missingLinks) {
      console.log(`❌ broken link in ${m.from}: ${m.link} → ${m.resolved}`);
    }
  } else {
    pass = check('front-desk index links resolve', true) && pass;
  }

  const stalePatterns = [
    'SERVER_DECOMPOSITION.md',
    'RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md',
    'KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md',
    'kelly_rails_v2_as_built.md',
    'phase5-9-checklist.md',
    'phase6-ops-checklist.md',
    'phase7-8-checklist.md'
  ];

  const grepFiles = ['docs/README.md', 'docs/meta/CANONICAL_DOC_MAP.md', 'docs/voice-agent/README.md'];
  let staleOk = true;
  for (const rel of grepFiles) {
    const content = read(rel);
    for (const pat of stalePatterns) {
      if (content.includes(pat)) {
        staleOk = false;
        pass = check(`no stale ref "${pat}" in ${rel}`, false) && pass;
      }
    }
  }
  if (staleOk) {
    pass = check('no stale path refs in front-desk indexes', true) && pass;
  }

  console.log(`\n${pass ? '✅' : '❌'} doc hygiene ${pass ? 'PASS' : 'FAIL'}\n`);
  process.exit(pass ? 0 : 1);
}

main();
