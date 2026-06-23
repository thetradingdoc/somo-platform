function up(db) {
  const cols = db.prepare('PRAGMA table_info(product_ingredients)').all().map((c) => c.name);
  if (!cols.includes('normalized_inci')) {
    db.exec('ALTER TABLE product_ingredients ADD COLUMN normalized_inci TEXT');
  }
  if (!cols.includes('ingredient_role')) {
    db.exec('ALTER TABLE product_ingredients ADD COLUMN ingredient_role TEXT');
  }
  if (!cols.includes('confidence')) {
    db.exec('ALTER TABLE product_ingredients ADD COLUMN confidence TEXT');
  }

  db.exec(`DROP VIEW IF EXISTS ingredient_regulatory_profile`);
  db.exec(`
    CREATE VIEW ingredient_regulatory_profile AS
    SELECT
      LOWER(TRIM(COALESCE(c.inci_name, b.inci_name))) AS inci_key,
      c.inci_name AS cosing_inci_name,
      b.inci_name AS biochem_inci_name,
      c.functions_json AS cosing_functions_json,
      c.restrictions_json AS cosing_restrictions_json,
      c.cas_number,
      c.ec_number,
      b.pathways_json AS biochem_pathways_json,
      b.evidence_level AS biochem_evidence_level,
      b.pubchem_cid,
      b.derivative_of,
      b.molecular_class
    FROM cosing_ingredients c
    LEFT JOIN ingredient_biochem b ON LOWER(TRIM(b.inci_name)) = LOWER(TRIM(c.inci_name))
    UNION
    SELECT
      LOWER(TRIM(b.inci_name)) AS inci_key,
      NULL AS cosing_inci_name,
      b.inci_name AS biochem_inci_name,
      NULL AS cosing_functions_json,
      NULL AS cosing_restrictions_json,
      NULL AS cas_number,
      NULL AS ec_number,
      b.pathways_json AS biochem_pathways_json,
      b.evidence_level AS biochem_evidence_level,
      b.pubchem_cid,
      b.derivative_of,
      b.molecular_class
    FROM ingredient_biochem b
    WHERE NOT EXISTS (
      SELECT 1 FROM cosing_ingredients c WHERE LOWER(TRIM(c.inci_name)) = LOWER(TRIM(b.inci_name))
    );
  `);
}

function down() {}

module.exports = { up, down };
