#!/usr/bin/env node
/**
 * Merge all *.md under each docs/<subdir>/ into docs/<subdir>/README.md
 * (same pattern as middleware-platform + reasoning).
 *
 * Skips: docs/<name>/ with only 1 .md file; docs/reasoning, docs/middleware-platform (already consolidated).
 *
 * Usage: node scripts/consolidate-docs-subfolders.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const SKIP_NAMES = new Set(['reasoning', 'middleware-platform', 'voice-agent']);

function walkMdFiles(dir, out) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walkMdFiles(p, out);
    else if (name.name.endsWith('.md')) out.push(p);
  }
}

function slugFromRel(relPosix) {
  return relPosix
    .replace(/\.md$/i, '')
    .replace(/\//g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
}

function stripFirstH1(md) {
  const lines = md.split('\n');
  if (lines[0] && /^#\s/.test(lines[0])) return lines.slice(1).join('\n').replace(/^\n+/, '');
  return md;
}

function titleFromBody(body, fallback) {
  const first = body.split('\n').find((l) => l.trim());
  if (first && /^#\s+/.test(first)) return first.replace(/^#\s+/, '').trim();
  return fallback;
}

function mergeFolder(folderName) {
  const folder = path.join(DOCS, folderName);
  if (!fs.statSync(folder).isDirectory()) return null;

  const files = [];
  walkMdFiles(folder, files);
  if (files.length <= 1) return null;

  files.sort((a, b) => a.localeCompare(b));

  const redirects = {};
  const toc = [];
  const parts = [];

  parts.push(`# ${folderName.replace(/-/g, ' ')} — consolidated documentation

**Single file:** All former \`docs/${folderName}/**/*.md\` content is merged here. **Last updated:** ${new Date().toISOString().slice(0, 10)}

## Table of contents

`);

  for (const abs of files) {
    const rel = path.relative(folder, abs).replace(/\\/g, '/');
    const body = fs.readFileSync(abs, 'utf8');
    const id = slugFromRel(rel);
    const title = titleFromBody(body, rel.replace(/\.md$/i, ''));
    toc.push(`- [${title} (\`${rel}\`)](#${id})`);
    if (rel !== 'README.md') {
      redirects[`docs/${folderName}/${rel}`] = `docs/${folderName}/README.md#${id}`;
    }
  }

  parts.push(toc.join('\n'));
  parts.push('\n---\n\n## Introduction\n\nBrowse by anchor above. Each section notes the former file path.\n\n');

  for (const abs of files) {
    const rel = path.relative(folder, abs).replace(/\\/g, '/');
    const body = fs.readFileSync(abs, 'utf8');
    const id = slugFromRel(rel);
    const title = titleFromBody(body, rel.replace(/\.md$/i, ''));
    const inner = stripFirstH1(body);
    parts.push(`---\n\n<a id="${id}"></a>\n\n## ${title}\n\n*Former path: \`docs/${folderName}/${rel}\`*\n\n${inner}\n\n`);
  }

  const out = parts.join('');
  const readmePath = path.join(folder, 'README.md');

  for (const abs of files) {
    if (path.resolve(abs) === path.resolve(readmePath)) continue;
    fs.unlinkSync(abs);
  }

  fs.writeFileSync(readmePath, out, 'utf8');
  return { folder: folderName, redirects, bytes: out.length, sections: files.length };
}

function main() {
  const results = [];
  const allRedirects = {};

  for (const name of fs.readdirSync(DOCS)) {
    if (SKIP_NAMES.has(name)) continue;
    const full = path.join(DOCS, name);
    if (!fs.statSync(full).isDirectory()) continue;
    const r = mergeFolder(name);
    if (r) {
      results.push(r);
      Object.assign(allRedirects, r.redirects);
    }
  }

  const mapPath = path.join(DOCS, '_consolidated_path_redirects.json');
  fs.writeFileSync(mapPath, JSON.stringify(allRedirects, null, 2), 'utf8');
  console.log(JSON.stringify({ merged: results, redirectMap: mapPath }, null, 2));
}

main();
