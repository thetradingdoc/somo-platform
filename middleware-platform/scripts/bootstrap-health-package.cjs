'use strict';

/**
 * Bootstrap services/health/ from legacy top-level health-* and kelly-pa-* modules.
 * Run once during migration; shims remain at old paths.
 */
const fs = require('fs');
const path = require('path');

const SERVICES = path.join(__dirname, '..', 'services');
const HEALTH = path.join(SERVICES, 'health');

const MOVES = [
  ['health-session-service.js', 'session-service.js'],
  ['health-turn-service.js', 'turn-service.js'],
  ['health-session-report-service.js', 'report-service.js'],
  ['health-video-opqrst.js', 'opqrst.js'],
  ['health-diagnosis-guard.js', 'diagnosis-guard.js'],
  ['health-care-pathway.js', 'care-pathway.js'],
  ['health-visit-summary.js', 'visit-summary.js'],
  ['health-video-skin-router.js', 'skin-router.js'],
  ['health-vision-caption-bridge.js', 'vision-caption-bridge.js'],
  ['health-education-retriever.js', 'education-retriever.js'],
  ['health-video-model-router.js', 'model-router.js'],
  ['health-video-feature-flags.js', 'feature-flags.js'],
  ['health-session-projection.js', 'session-projection.js'],
  ['health-session-routing-service.js', 'session-routing-service.js'],
  ['health-session-eligibility-service.js', 'session-eligibility-service.js'],
  ['health-server-stt-bridge.js', 'server-stt-bridge.js'],
  ['kelly-pa-video-orchestrator.js', 'agent/orchestrator.js'],
  ['kelly-pa-video-prompt.js', 'agent/prompt.js'],
  ['health-langchain-tools.js', 'agent/groq-tools.js'],
  ['video-tool-registry.js', 'tools/registry.js']
];

const REPLACE_IMPORTS = [
  [/\.\/health-session-service/g, './session-service'],
  [/\.\/health-turn-service/g, './turn-service'],
  [/\.\/health-session-report-service/g, './report-service'],
  [/\.\/health-video-opqrst/g, './opqrst'],
  [/\.\/health-diagnosis-guard/g, './diagnosis-guard'],
  [/\.\/health-care-pathway/g, './care-pathway'],
  [/\.\/health-visit-summary/g, './visit-summary'],
  [/\.\/health-video-skin-router/g, './skin-router'],
  [/\.\/health-vision-caption-bridge/g, './vision-caption-bridge'],
  [/\.\/health-education-retriever/g, './education-retriever'],
  [/\.\/health-video-model-router/g, './model-router'],
  [/\.\/health-video-feature-flags/g, './feature-flags'],
  [/\.\/health-session-projection/g, './session-projection'],
  [/\.\/health-session-routing-service/g, './session-routing-service'],
  [/\.\/health-session-eligibility-service/g, './session-eligibility-service'],
  [/\.\/health-server-stt-bridge/g, './server-stt-bridge'],
  [/\.\/kelly-pa-video-orchestrator/g, './agent/orchestrator'],
  [/\.\/kelly-pa-video-prompt/g, './agent/prompt'],
  [/\.\/health-langchain-tools/g, './agent/groq-tools'],
  [/\.\/video-tool-registry/g, './tools/registry'],
  [/\.\.\/utils\//g, '../../utils/'],
  [/\.\.\/database/g, '../../database'],
  [/\.\.\/services\/layer2-rag\//g, '../layer2-rag/'],
  [/\.\.\/services\/derm-patient-qa-/g, '../derm-patient-qa-'],
  [/\.\.\/services\/vision-/g, '../vision-'],
  [/\.\.\/services\/safety-prescreen/g, '../safety-prescreen'],
  [/\.\.\/services\/kelly-tool-executor/g, '../kelly-tool-executor']
];

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function transformContent(content, destRel) {
  let out = content;
  if (destRel.startsWith('agent/') || destRel.startsWith('tools/')) {
    out = out.replace(/\.\.\/utils\//g, '../../utils/');
    out = out.replace(/\.\.\/database/g, '../../database');
    out = out.replace(/require\('\.\.\/services\//g, "require('../");
  }
  for (const [from, to] of REPLACE_IMPORTS) {
    out = out.replace(from, to);
  }
  return out;
}

function main() {
  ensureDir(path.join(HEALTH, 'agent'));
  ensureDir(path.join(HEALTH, 'tools'));
  ensureDir(path.join(HEALTH, 'transport'));

  for (const [srcName, destRel] of MOVES) {
    const src = path.join(SERVICES, srcName);
    const dest = path.join(HEALTH, destRel);
    if (!fs.existsSync(src)) {
      console.warn('skip missing', srcName);
      continue;
    }
    ensureDir(path.dirname(dest));
    const content = fs.readFileSync(src, 'utf8');
    fs.writeFileSync(dest, transformContent(content, destRel));
    const shimPath = path.join(HEALTH, destRel.replace(/\.js$/, ''));
    const shimTarget = './' + path.relative(SERVICES, dest).split(path.sep).join('/');
    if (!fs.existsSync(src)) continue;
    // shim at old path
    const shimModule = `'use strict';\nmodule.exports = require('${shimTarget.replace(/\\/g, '/')}');\n`;
    if (srcName !== 'video-tool-registry.js') {
      fs.writeFileSync(src, shimModule);
    }
  }

  // video-tool-registry shim at services root
  fs.writeFileSync(
    path.join(SERVICES, 'video-tool-registry.js'),
    "'use strict';\nmodule.exports = require('./health/tools/registry');\n"
  );

  // kelly-pa shims
  for (const name of ['kelly-pa-video-orchestrator.js', 'kelly-pa-video-prompt.js']) {
    const target = name.includes('orchestrator') ? './health/agent/orchestrator' : './health/agent/prompt';
    fs.writeFileSync(path.join(SERVICES, name), `'use strict';\nmodule.exports = require('${target}');\n`);
  }

  fs.writeFileSync(path.join(SERVICES, 'health-langchain-tools.js'), "'use strict';\nmodule.exports = require('./health/agent/groq-tools');\n");

  console.log('health package bootstrap done');
}

main();
