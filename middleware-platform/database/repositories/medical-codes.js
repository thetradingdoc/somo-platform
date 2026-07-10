'use strict';

/**
 * Medical codebooks + embeddings (ICD-10, CPT, HCPCS, code_embeddings).
 * Wired from database.js via createMedicalCodesRepository(sqliteDb).
 */

function deriveSpecialtyFromCode(code, codeType) {
  if (!code || !codeType) return 'general';
  const c = String(code).toUpperCase().trim();
  if (codeType === 'icd10') {
    if (/^[ST]\d/.test(c)) return 'orthopedics';
    if (/^I\d/.test(c)) return 'cardiology';
    if (/^J\d/.test(c)) return 'pulmonology';
    if (/^G\d/.test(c)) return 'neurology';
    if (/^L\d/.test(c)) return 'dermatology';
    if (/^K\d/.test(c)) return 'gastroenterology';
    if (/^R\d/.test(c)) return 'emergency';
  }
  if (codeType === 'cpt') {
    if (/^(2[0-4]\d{3}|2[5-9]\d{3})/.test(c)) return 'orthopedics';
    if (/^(93\d{3})/.test(c)) return 'cardiology';
    if (/^(94\d{3})/.test(c)) return 'pulmonology';
  }
  return 'general';
}

function createMedicalCodesRepository(db) {
  function _codeEmbeddingsHasSpecialty() {
    return db.prepare('PRAGMA table_info(code_embeddings)').all().some((col) => col.name === 'specialty');
  }

  function _codeEmbeddingsSelectSql(codeType = null, specialty = null) {
    const hasSpecialty = _codeEmbeddingsHasSpecialty();
    if (codeType && specialty && hasSpecialty) {
      return {
        sql: `SELECT code, code_type, description_text, embedding_json, specialty FROM code_embeddings
        WHERE embedding_json IS NOT NULL AND code_type = ? AND (specialty = ? OR specialty IS NULL OR specialty = '')
        ORDER BY id LIMIT ? OFFSET ?`,
        params: (limit, offset) => [codeType, specialty, limit, offset]
      };
    }
    if (codeType) {
      return {
        sql: `SELECT code, code_type, description_text, embedding_json${hasSpecialty ? ', specialty' : ''} FROM code_embeddings
        WHERE embedding_json IS NOT NULL AND code_type = ?
        ORDER BY id LIMIT ? OFFSET ?`,
        params: (limit, offset) => [codeType, limit, offset]
      };
    }
    if (specialty && hasSpecialty) {
      return {
        sql: `SELECT code, code_type, description_text, embedding_json, specialty FROM code_embeddings
        WHERE embedding_json IS NOT NULL AND (specialty = ? OR specialty IS NULL OR specialty = '')
        ORDER BY id LIMIT ? OFFSET ?`,
        params: (limit, offset) => [specialty, limit, offset]
      };
    }
    return {
      sql: `SELECT code, code_type, description_text, embedding_json${hasSpecialty ? ', specialty' : ''} FROM code_embeddings
      WHERE embedding_json IS NOT NULL
      ORDER BY id LIMIT ? OFFSET ?`,
      params: (limit, offset) => [limit, offset]
    };
  }

  function _mapCodeEmbeddingRow(r) {
    if (!r.embedding_json) return null;
    return {
      code: r.code,
      code_type: r.code_type,
      description_text: r.description_text,
      embedding: JSON.parse(r.embedding_json),
      specialty: r.specialty || null
    };
  }

  function getCodeEmbeddingsBatch(codeType = null, specialty = null, offset = 0, limit = 2000) {
    const { sql, params } = _codeEmbeddingsSelectSql(codeType, specialty);
    const rows = db.prepare(sql).all(...params(limit, offset));
    return rows.map(_mapCodeEmbeddingRow).filter(Boolean);
  }

  function bulkUpsertCptCodes(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
      return { inserted: 0 };
    }

    const stmt = db.prepare(`
    INSERT INTO cpt_codes (code, description, category, subcategory, is_new)
    VALUES (@code, @description, @category, @subcategory, @is_new)
    ON CONFLICT(code) DO UPDATE SET
      description = excluded.description,
      category = excluded.category,
      subcategory = excluded.subcategory,
      is_new = excluded.is_new,
      updated_at = datetime('now')
  `);

    const insertMany = db.transaction((codes) => {
      for (const item of codes) {
        if (!item || !item.code || !item.description) continue;
        stmt.run({
          code: String(item.code).toUpperCase(),
          description: item.description,
          category: item.category || null,
          subcategory: item.subcategory || null,
          is_new: item.is_new ? 1 : 0
        });
      }
    });

    insertMany(items);
    return { inserted: items.length };
  }

  function searchCptCodes(query, limit = 10) {
    if (!query || !query.trim()) return [];
    const term = `%${query.trim().toLowerCase()}%`;
    return db.prepare(`
    SELECT code, description, category, subcategory
    FROM cpt_codes
    WHERE LOWER(code) LIKE ? OR LOWER(description) LIKE ?
    ORDER BY CASE WHEN LOWER(code) LIKE ? THEN 0 ELSE 1 END,
             description
    LIMIT ?
  `).all(term, term, term, limit);
  }

  function bulkUpsertIcd10Codes(items = []) {
    if (!Array.isArray(items) || items.length === 0) return { inserted: 0 };
    const stmt = db.prepare(`
    INSERT INTO icd10_codes (code, description, category, billable, source_file)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      description = excluded.description,
      category = excluded.category,
      billable = excluded.billable,
      source_file = excluded.source_file
  `);
    let count = 0;
    for (const item of items) {
      if (!item || !item.code || !item.description) continue;
      stmt.run(
        String(item.code).trim().toUpperCase(),
        String(item.description).trim(),
        item.category || null,
        item.billable != null ? (item.billable ? 1 : 0) : 1,
        item.source_file || null
      );
      count++;
    }
    return { inserted: count };
  }

  function searchIcd10Codes(query, limit = 15) {
    const q = (query || '').toString().trim();
    if (!q) return [];
    const term = `%${q.toLowerCase()}%`;
    return db.prepare(`
    SELECT code, description, category, billable
    FROM icd10_codes
    WHERE LOWER(code) LIKE ? OR LOWER(description) LIKE ?
    ORDER BY CASE WHEN LOWER(code) LIKE ? THEN 0 ELSE 1 END,
             CASE WHEN LOWER(code) = LOWER(?) THEN 0 ELSE 1 END,
             description
    LIMIT ?
  `).all(term, term, term, q, limit);
  }

  function getIcd10CodesCount() {
    const row = db.prepare('SELECT COUNT(*) as n FROM icd10_codes').get();
    return row ? row.n : 0;
  }

  function bulkUpsertHcpcsCodes(items = []) {
    if (!Array.isArray(items) || items.length === 0) return { inserted: 0 };
    const stmt = db.prepare(`
    INSERT INTO hcpcs_codes (code, long_desc, short_desc, pricing_ind, coverage_cd, type, source_file)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      long_desc = excluded.long_desc,
      short_desc = excluded.short_desc,
      pricing_ind = excluded.pricing_ind,
      coverage_cd = excluded.coverage_cd,
      type = excluded.type,
      source_file = excluded.source_file
  `);
    let count = 0;
    for (const item of items) {
      if (!item || !item.code || !item.long_desc) continue;
      stmt.run(
        String(item.code).trim().toUpperCase(),
        String(item.long_desc).trim(),
        item.short_desc ? String(item.short_desc).trim() : null,
        item.pricing_ind || null,
        item.coverage_cd || null,
        item.type || null,
        item.source_file || null
      );
      count++;
    }
    return { inserted: count };
  }

  function searchHcpcsCodes(query, limit = 15) {
    const q = (query || '').toString().trim();
    if (!q) return [];
    const term = `%${q.toLowerCase()}%`;
    return db.prepare(`
    SELECT code, long_desc, short_desc, pricing_ind, coverage_cd, type
    FROM hcpcs_codes
    WHERE LOWER(code) LIKE ? OR LOWER(long_desc) LIKE ? OR LOWER(short_desc) LIKE ?
    ORDER BY CASE WHEN LOWER(code) LIKE ? THEN 0 ELSE 1 END,
             CASE WHEN LOWER(code) = LOWER(?) THEN 0 ELSE 1 END,
             long_desc
    LIMIT ?
  `).all(term, term, term, term, q, limit);
  }

  function getHcpcsCodesCount() {
    const row = db.prepare('SELECT COUNT(*) as n FROM hcpcs_codes').get();
    return row ? row.n : 0;
  }

  function bulkUpsertIcd10PcsCodes(items = []) {
    if (!Array.isArray(items) || items.length === 0) return { inserted: 0 };
    const stmt = db.prepare(`
    INSERT INTO icd10_pcs_codes (code, description, source_file)
    VALUES (?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      description = excluded.description,
      source_file = excluded.source_file,
      updated_at = datetime('now')
  `);
    let count = 0;
    for (const item of items) {
      if (!item || !item.code || !item.description) continue;
      stmt.run(
        String(item.code).trim().toUpperCase(),
        String(item.description).trim(),
        item.source_file || null
      );
      count++;
    }
    return { inserted: count };
  }

  function searchIcd10PcsCodes(query, limit = 15) {
    const q = (query || '').toString().trim();
    if (!q) return [];
    const term = `%${q.toLowerCase()}%`;
    return db.prepare(`
    SELECT code, description
    FROM icd10_pcs_codes
    WHERE LOWER(code) LIKE ? OR LOWER(description) LIKE ?
    ORDER BY CASE WHEN LOWER(code) LIKE ? THEN 0 ELSE 1 END,
             CASE WHEN LOWER(code) = LOWER(?) THEN 0 ELSE 1 END,
             description
    LIMIT ?
  `).all(term, term, term, q, limit);
  }

  function getIcd10PcsCodesCount() {
    const row = db.prepare('SELECT COUNT(*) as n FROM icd10_pcs_codes').get();
    return row ? row.n : 0;
  }

  function bulkUpsertPlaceOfServiceCodes(items = []) {
    if (!Array.isArray(items) || items.length === 0) return { inserted: 0 };
    const stmt = db.prepare(`
    INSERT INTO place_of_service_codes (code, description, is_telehealth)
    VALUES (?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      description = excluded.description,
      is_telehealth = excluded.is_telehealth
  `);
    let count = 0;
    for (const item of items) {
      if (!item || !item.code || !item.description) continue;
      stmt.run(
        String(item.code).trim(),
        String(item.description).trim(),
        item.is_telehealth ? 1 : 0
      );
      count++;
    }
    return { inserted: count };
  }

  function bulkUpsertModifierCodes(items = []) {
    if (!Array.isArray(items) || items.length === 0) return { inserted: 0 };
    const stmt = db.prepare(`
    INSERT INTO modifier_codes (code, description, applies_to, telehealth_required, payer_type)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      description = excluded.description,
      applies_to = excluded.applies_to,
      telehealth_required = excluded.telehealth_required,
      payer_type = excluded.payer_type
  `);
    let count = 0;
    for (const item of items) {
      if (!item || !item.code || !item.description) continue;
      stmt.run(
        String(item.code).trim().toUpperCase(),
        String(item.description).trim(),
        item.applies_to || 'cpt',
        item.telehealth_required ? 1 : 0,
        item.payer_type || 'any'
      );
      count++;
    }
    return { inserted: count };
  }

  function codeExists(code, codeType) {
    if (!code || !codeType) return false;
    const raw = String(code).trim().toUpperCase();
    const noDots = raw.replace(/\./g, '');
    if (codeType === 'icd10') {
      const r = db.prepare('SELECT 1 FROM icd10_codes WHERE UPPER(TRIM(code)) = ? OR UPPER(TRIM(code)) = ?').get(raw, noDots);
      if (r) return true;
      const r2 = db.prepare("SELECT 1 FROM icd10_codes WHERE UPPER(REPLACE(TRIM(code), '.', '')) = ?").get(noDots);
      return r2 != null;
    }
    if (codeType === 'cpt') {
      return db.prepare('SELECT 1 FROM cpt_codes WHERE UPPER(TRIM(code)) = ?').get(raw) != null;
    }
    if (codeType === 'hcpcs') {
      return db.prepare('SELECT 1 FROM hcpcs_codes WHERE UPPER(TRIM(code)) = ?').get(raw) != null;
    }
    if (codeType === 'icd10_pcs') {
      return db.prepare('SELECT 1 FROM icd10_pcs_codes WHERE UPPER(TRIM(code)) = ?').get(raw) != null;
    }
    return false;
  }

  /** @deprecated Prefer getCodeEmbeddingsBatch for semantic search (avoids loading 80k+ rows). */
  function getAllCodeEmbeddings(codeType = null, specialty = null) {
    const out = [];
    const batchSize = 2000;
    let offset = 0;
    for (;;) {
      const chunk = getCodeEmbeddingsBatch(codeType, specialty, offset, batchSize);
      if (!chunk.length) break;
      out.push(...chunk);
      offset += batchSize;
    }
    return out;
  }

  function getCodeEmbeddingsForCodes(codeType, codes = []) {
    const list = [...new Set((codes || []).map((c) => String(c).trim()).filter(Boolean))];
    if (!list.length) return [];
    const hasSpecialty = _codeEmbeddingsHasSpecialty();
    const placeholders = list.map(() => '?').join(',');
    const sql = `SELECT code, code_type, description_text, embedding_json${hasSpecialty ? ', specialty' : ''}
    FROM code_embeddings
    WHERE embedding_json IS NOT NULL AND code_type = ? AND code IN (${placeholders})`;
    const rows = db.prepare(sql).all(codeType, ...list);
    return rows.map(_mapCodeEmbeddingRow).filter(Boolean);
  }

  function upsertCodeEmbedding(record) {
    const id = record.id || `${record.code_type}_${record.code}`;
    const specialty = record.specialty || deriveSpecialtyFromCode(record.code, record.code_type);
    try {
      const hasSpecialty = db.prepare('PRAGMA table_info(code_embeddings)').all().some((col) => col.name === 'specialty');
      if (hasSpecialty) {
        db.prepare(`
        INSERT INTO code_embeddings (id, code, code_type, description_text, embedding_json, specialty)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          description_text = excluded.description_text,
          embedding_json = excluded.embedding_json,
          specialty = excluded.specialty
      `).run(id, record.code, record.code_type, record.description_text || null, record.embedding_json || null, specialty);
      } else {
        db.prepare(`
        INSERT INTO code_embeddings (id, code, code_type, description_text, embedding_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          description_text = excluded.description_text,
          embedding_json = excluded.embedding_json
      `).run(id, record.code, record.code_type, record.description_text || null, record.embedding_json || null);
      }
    } catch (_) {
      db.prepare(`
      INSERT INTO code_embeddings (id, code, code_type, description_text, embedding_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        description_text = excluded.description_text,
        embedding_json = excluded.embedding_json
    `).run(id, record.code, record.code_type, record.description_text || null, record.embedding_json || null);
    }
    return id;
  }

  function getCodeEmbeddingsCount() {
    const row = db.prepare('SELECT COUNT(*) as n FROM code_embeddings WHERE embedding_json IS NOT NULL').get();
    return row ? row.n : 0;
  }

  function backfillCodeEmbeddingSpecialty() {
    const tableInfo = db.prepare('PRAGMA table_info(code_embeddings)').all();
    const hasSpecialty = tableInfo.some((c) => c.name === 'specialty');
    if (!hasSpecialty) return { updated: 0, skipped: 0, reason: 'specialty_column_missing' };
    const rows = db.prepare('SELECT id, code, code_type FROM code_embeddings WHERE specialty IS NULL OR specialty = \'\'').all();
    let updated = 0;
    const updateStmt = db.prepare('UPDATE code_embeddings SET specialty = ? WHERE id = ?');
    for (const r of rows) {
      const specialty = deriveSpecialtyFromCode(r.code, r.code_type);
      updateStmt.run(specialty, r.id);
      updated++;
    }
    return { updated, skipped: 0 };
  }

  function getCptCodesByCodes(codes = []) {
    if (!Array.isArray(codes) || codes.length === 0) return [];
    const normalized = codes
      .map((code) => String(code || '').trim().toUpperCase())
      .filter((code) => code.length > 0);

    if (normalized.length === 0) return [];

    const placeholders = normalized.map(() => '?').join(', ');
    return db.prepare(
      `SELECT code, description, category, subcategory FROM cpt_codes WHERE code IN (${placeholders})`
    ).all(...normalized);
  }

  function bulkUpsertCdtCodes(items = []) {
    if (!Array.isArray(items) || items.length === 0) return { inserted: 0 };
    const stmt = db.prepare(`
    INSERT INTO cdt_codes (code, description, category, subcategory, billable, source_file)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      description = excluded.description,
      category = excluded.category,
      subcategory = excluded.subcategory,
      billable = excluded.billable,
      source_file = excluded.source_file,
      updated_at = datetime('now')
  `);
    let count = 0;
    for (const item of items) {
      if (!item || !item.code || !item.description) continue;
      stmt.run(
        String(item.code).trim().toUpperCase(),
        String(item.description).trim(),
        item.category || null,
        item.subcategory || null,
        item.billable != null ? (item.billable ? 1 : 0) : 1,
        item.source_file || null
      );
      count++;
    }
    return { inserted: count };
  }

  function searchCdtCodes(query, limit = 15) {
    const q = (query || '').toString().trim();
    if (!q) return [];
    const term = `%${q.toLowerCase()}%`;
    return db.prepare(`
    SELECT code, description, category, subcategory
    FROM cdt_codes
    WHERE LOWER(code) LIKE ? OR LOWER(description) LIKE ?
    ORDER BY CASE WHEN LOWER(code) LIKE ? THEN 0 ELSE 1 END,
             CASE WHEN LOWER(code) = LOWER(?) THEN 0 ELSE 1 END,
             description
    LIMIT ?
  `).all(term, term, term, q, limit);
  }

  function getCdtCodesCount() {
    try {
      const row = db.prepare('SELECT COUNT(*) as n FROM cdt_codes').get();
      return row ? row.n : 0;
    } catch (_) {
      return 0;
    }
  }

  return {
    bulkUpsertCptCodes,
    searchCptCodes,
    bulkUpsertCdtCodes,
    searchCdtCodes,
    getCdtCodesCount,
    bulkUpsertIcd10Codes,
    searchIcd10Codes,
    getIcd10CodesCount,
    bulkUpsertHcpcsCodes,
    searchHcpcsCodes,
    getHcpcsCodesCount,
    bulkUpsertIcd10PcsCodes,
    searchIcd10PcsCodes,
    getIcd10PcsCodesCount,
    bulkUpsertPlaceOfServiceCodes,
    bulkUpsertModifierCodes,
    codeExists,
    getAllCodeEmbeddings,
    getCodeEmbeddingsBatch,
    getCodeEmbeddingsForCodes,
    upsertCodeEmbedding,
    getCodeEmbeddingsCount,
    backfillCodeEmbeddingSpecialty,
    getCptCodesByCodes
  };
}

module.exports = { createMedicalCodesRepository };
