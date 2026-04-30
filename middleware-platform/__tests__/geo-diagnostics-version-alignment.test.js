const Database = require('better-sqlite3');
const { getGeoCompletenessDiagnostics } = require('../routes/geo-diagnostics');

function hasTableFactory(db) {
  return (tableName) => Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(String(tableName || ''))
  );
}

describe('geo diagnostics version alignment', () => {
  test('uses populated canonical version when active version is stale', () => {
    process.env.PUBLIC_GEO_MIN_DISTINCT_ZIPS = '2';
    process.env.PUBLIC_GEO_MIN_DISTINCT_COUNTIES = '2';
    process.env.PUBLIC_GEO_MIN_STATES_WITH_COUNTIES = '1';

    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE geo_dataset_versions (source_version TEXT PRIMARY KEY, is_active INTEGER DEFAULT 0, published_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE geo_zip (zip5 TEXT, source_version TEXT);
      CREATE TABLE geo_county (county_fips TEXT, state_abbr TEXT, source_version TEXT);
      CREATE TABLE geo_zip_county_map (zip5 TEXT, county_fips TEXT, source_version TEXT);
      CREATE TABLE zip_county_crosswalk (zip_code TEXT, county_fips TEXT, county_name TEXT);
      CREATE TABLE payor_plan_service_areas (county_fips TEXT, state_abbr TEXT);
    `);

    db.exec(`
      INSERT INTO geo_dataset_versions(source_version, is_active) VALUES ('geo-stale', 1), ('geo-fresh', 0);
      INSERT INTO geo_zip(zip5, source_version) VALUES ('00001', 'geo-stale'), ('07205', 'geo-fresh'), ('10001', 'geo-fresh');
      INSERT INTO geo_county(county_fips, state_abbr, source_version) VALUES ('00001', 'NJ', 'geo-stale'), ('34039', 'NJ', 'geo-fresh'), ('36061', 'NY', 'geo-fresh');
      INSERT INTO geo_zip_county_map(zip5, county_fips, source_version) VALUES ('00001', '00001', 'geo-stale'), ('07205', '34039', 'geo-fresh'), ('10001', '36061', 'geo-fresh');
      INSERT INTO zip_county_crosswalk(zip_code, county_fips, county_name) VALUES ('07205', '34039', 'Union County'), ('10001', '36061', 'New York County');
      INSERT INTO payor_plan_service_areas(county_fips, state_abbr) VALUES ('34039', 'NJ'), ('36061', 'NY');
    `);

    const diagnostics = getGeoCompletenessDiagnostics(db, hasTableFactory(db));
    expect(diagnostics.geo_version).toBe('geo-fresh');
    expect(diagnostics.distinct_zip_count).toBeGreaterThan(1);
    expect(diagnostics.distinct_county_count).toBeGreaterThan(1);
    expect(diagnostics.is_complete).toBe(true);

    delete process.env.PUBLIC_GEO_MIN_DISTINCT_ZIPS;
    delete process.env.PUBLIC_GEO_MIN_DISTINCT_COUNTIES;
    delete process.env.PUBLIC_GEO_MIN_STATES_WITH_COUNTIES;
    db.close();
  });
});
