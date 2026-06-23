function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS taxonomy_nodes (
      id TEXT PRIMARY KEY,
      module TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS taxonomy_edges (
      id TEXT PRIMARY KEY,
      from_node TEXT NOT NULL,
      relation TEXT NOT NULL,
      to_node TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS taxonomy_rules (
      id TEXT PRIMARY KEY,
      module TEXT NOT NULL,
      priority INTEGER DEFAULT 100,
      when_json TEXT NOT NULL,
      then_json TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_taxonomy_edges_from ON taxonomy_edges(from_node, relation);
    CREATE INDEX IF NOT EXISTS idx_taxonomy_rules_module_priority ON taxonomy_rules(module, active, priority);
  `);

  db.prepare(`
    INSERT OR IGNORE INTO taxonomy_rules (id, module, priority, when_json, then_json, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(
    'rule.over_exfoliation_guard',
    'skin_graph',
    10,
    JSON.stringify({ conditions_any: ['inflamed', 'barrier_compromised'], ingredients_any: ['aha', 'bha', 'glycolic acid', 'retinoid'] }),
    JSON.stringify({ clarify_required: true, blocked: true, next_question: 'How often are you using these actives each week?' })
  );

  db.prepare(`
    INSERT OR IGNORE INTO taxonomy_rules (id, module, priority, when_json, then_json, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(
    'rule.high_pigment_conservative',
    'skin_graph',
    20,
    JSON.stringify({ pigment_risk_any: ['high'], ingredients_any: ['aha', 'glycolic acid', 'retinoid'] }),
    JSON.stringify({ clarify_required: true, blocked: false, next_question: 'Given pigment sensitivity risk, can we start with a gentle cadence?' })
  );
}

function down() {
  // no-op for safety
}

module.exports = { up, down };
