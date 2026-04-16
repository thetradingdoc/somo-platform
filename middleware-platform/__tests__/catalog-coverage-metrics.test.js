'use strict';

const Database = require('better-sqlite3');
const { up: m028 } = require('../migrations/028_ingredient_interactions');
const { up: m031 } = require('../migrations/031_user_sessions_and_knowledge_chunks');
const { getCatalogCoverageMetrics } = require('../services/catalog-coverage-metrics');

describe('getCatalogCoverageMetrics', () => {
  it('returns reasoning_pair_coverage when graph and knowledge_chunks exist', () => {
    const db = new Database(':memory:');
    m028(db);
    m031(db);
    const m = getCatalogCoverageMetrics(db);
    expect(m.reasoning_pair_coverage.available).toBe(true);
    expect(typeof m.reasoning_pair_coverage.unique_conflict_pairs_in_graph).toBe('number');
    expect(m.knowledge_chunks.available).toBe(true);
    expect(m.ingredient_interactions.available).toBe(true);
    db.close();
  });
});
