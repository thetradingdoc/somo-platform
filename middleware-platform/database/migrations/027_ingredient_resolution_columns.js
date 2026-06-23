/**
 * Canonical ingredient IDs + match provenance on product_ingredients;
 * alias table for INCI synonyms → COSING inci_name.
 */
function up(db) {
  const cols = db.prepare('PRAGMA table_info(product_ingredients)').all().map((c) => c.name);
  if (!cols.includes('ingredient_canonical_id')) {
    db.exec('ALTER TABLE product_ingredients ADD COLUMN ingredient_canonical_id TEXT');
  }
  if (!cols.includes('match_method')) {
    db.exec('ALTER TABLE product_ingredients ADD COLUMN match_method TEXT');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ingredient_aliases (
      alias_norm TEXT PRIMARY KEY,
      canonical_inci TEXT NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ingredient_aliases_canonical ON ingredient_aliases(canonical_inci);
  `);

  const seed = [
    ['vitamin b3', 'niacinamide', 'common synonym'],
    ['vitamin b 3', 'niacinamide', 'common synonym'],
    ['b3', 'niacinamide', 'abbrev'],
    ['vitamin c', 'ascorbic acid', 'lay term → default L-ascorbic INCI'],
    ['l-ascorbic acid', 'ascorbic acid', 'INCI variant'],
    ['bha', 'salicylic acid', 'abbrev']
  ];
  const ins = db.prepare(`
    INSERT OR IGNORE INTO ingredient_aliases (alias_norm, canonical_inci, note) VALUES (?, ?, ?)
  `);
  for (const [a, c, n] of seed) {
    try {
      ins.run(String(a).trim().toLowerCase(), String(c).trim().toLowerCase(), n || null);
    } catch (_) {}
  }
}

function down() {}

module.exports = { up, down };
