'use strict';

/**
 * Filtered views over nppes_directory_providers for physician-focused search.
 *
 * NUCC: codes starting with 207 = "Allopathic & Osteopathic Physicians" (MD/DO).
 * Nurses (163*), NP/PA (363*), dental (122*), pharmacy (183*), hospitals (261*), etc. are excluded
 * by restricting to 207*.
 *
 * entity_type_code = '1' = individual (drops most hospitals, DME orgs, group billing entities that are type 2).
 *
 * Optional narrow view drops common primary-care taxonomies only; many internists still use 207R00000X
 * (Internal Medicine) — tune NOT IN list if you need stricter "subspecialist" behavior.
 */
function up(db) {
  db.exec(`
    DROP VIEW IF EXISTS nppes_v_physicians_md_do;
    DROP VIEW IF EXISTS nppes_v_physicians_specialists;

    CREATE VIEW nppes_v_physicians_md_do AS
    SELECT *
    FROM nppes_directory_providers
    WHERE entity_type_code = '1'
      AND specialty_code GLOB '207*';

    CREATE VIEW nppes_v_physicians_specialists AS
    SELECT *
    FROM nppes_directory_providers
    WHERE entity_type_code = '1'
      AND specialty_code GLOB '207*'
      AND specialty_code NOT IN (
        '207Q00000X',
        '207P00000X'
      );
  `);
}

function down(db) {
  db.exec(`
    DROP VIEW IF EXISTS nppes_v_physicians_specialists;
    DROP VIEW IF EXISTS nppes_v_physicians_md_do;
  `);
}

module.exports = { up, down };
