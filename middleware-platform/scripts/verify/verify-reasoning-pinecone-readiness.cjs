#!/usr/bin/env node
'use strict';

const {
  isPineconeConfigured,
  pineconeBaseUrl,
  pineconeNamespace,
  pineconeDescribeIndexStats,
} = require('../../services/platform/pinecone-rest');

async function main() {
  const configured = isPineconeConfigured();
  const base = pineconeBaseUrl();
  const namespace = pineconeNamespace() || '(default)';

  if (!configured) {
    console.log(JSON.stringify({
      success: true,
      configured: false,
      verified: true,
      exists: false,
      populated: false,
      reason: 'pinecone_not_configured',
      base,
      namespace,
    }, null, 2));
    return;
  }

  try {
    const stats = await pineconeDescribeIndexStats();
    const total = Number(stats?.totalVectorCount || 0);
    console.log(JSON.stringify({
      success: true,
      configured: true,
      verified: true,
      exists: true,
      populated: total > 0,
      total_vector_count: total,
      base,
      namespace,
    }, null, 2));
    if (total <= 0) process.exitCode = 2;
  } catch (err) {
    console.error(JSON.stringify({
      success: false,
      configured: true,
      verified: false,
      exists: false,
      populated: false,
      error: String(err?.message || err),
      base,
      namespace,
    }, null, 2));
    process.exitCode = 1;
  }
}

main();

