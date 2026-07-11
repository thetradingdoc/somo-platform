#!/usr/bin/env node
'use strict';

/** D-01 / DP-06: Confirm Pinecone + RAG env for deploy (local + optional Cloud Run). */
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const useCloudRun = process.argv.includes('--cloudrun');
const project = process.env.GCP_PROJECT || 'somo-callsomo';
const service = process.env.CLOUDRUN_SERVICE || 'somo-middleware';
const region = process.env.GCP_REGION || 'us-central1';

const required = ['PINECONE_API_KEY', 'PINECONE_INDEX_HOST'];
const optional = ['PINECONE_MIN_SCORE', 'PINECONE_FALLBACK_MIN_SCORE', 'EMBEDDING_MODEL', 'EMBEDDING_DIM'];
const checks = [];

for (const k of required) {
  checks.push({ name: k, scope: 'local', pass: !!process.env[k], value: process.env[k] ? 'set' : 'missing' });
}
checks.push({
  name: 'RAG_API_URL',
  scope: 'local',
  pass: process.env.RAG_API_URL === 'disabled',
  value: process.env.RAG_API_URL || '(unset — must be disabled)'
});
for (const k of optional) {
  checks.push({ name: k, scope: 'local', pass: true, value: process.env[k] || 'default' });
}

if (useCloudRun) {
  try {
    const yaml = execSync(
      `gcloud run services describe ${service} --project ${project} --region ${region} --format="yaml(spec.template.spec.containers[0].env)"`,
      { encoding: 'utf8', shell: '/bin/bash' }
    );
    const hasPineconeKey = /PINECONE_API_KEY/.test(yaml);
    const hasPineconeHost = /PINECONE_INDEX_HOST/.test(yaml);
    const ragDisabled = /RAG_API_URL[\s\S]*?disabled/.test(yaml) || /value:\s*disabled/.test(yaml);
    checks.push({ name: 'PINECONE_API_KEY', scope: 'cloudrun', pass: hasPineconeKey, value: hasPineconeKey ? 'bound' : 'missing' });
    checks.push({ name: 'PINECONE_INDEX_HOST', scope: 'cloudrun', pass: hasPineconeHost, value: hasPineconeHost ? 'bound' : 'missing' });
    checks.push({ name: 'RAG_API_URL', scope: 'cloudrun', pass: ragDisabled, value: ragDisabled ? 'disabled' : 'not disabled' });
  } catch (e) {
    checks.push({ name: 'gcloud_describe', scope: 'cloudrun', pass: false, value: e.message });
  }
}

const failed = checks.filter((c) => !c.pass);
const out = { checks, success: failed.length === 0, cloudrun: useCloudRun };
console.log(JSON.stringify(out, null, 2));
if (process.argv.includes('--out')) {
  const outPath = process.argv[process.argv.indexOf('--out') + 1];
  if (outPath) require('fs').writeFileSync(outPath, JSON.stringify(out, null, 2));
}
process.exit(failed.length ? 2 : 0);
