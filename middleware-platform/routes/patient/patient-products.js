'use strict';

function registerPatientProductsRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    requirePatientSession,
    resolvePatientIdFromSession,
    recordPatientPortalEvent,
    ensureRoutineTables,
    ensureBillingTables,
    ensurePatientShelfInventoryColumns,
    loadPatientShelfProductRows,
    formatShelfProductApiRow,
    parseBillingDocumentUpload,
    safeParseJsonArray,
    isIsoDateOnly,
    localDateFromIso,
    isoFromLocalDate,
    weekdayKeyForIsoLocal,
    enumerateIsoDates,
    issuePatientDocumentDownloadUrl,
    fetchBillingAggregatesByDay,
    fieldsFromSqlAggRow,
    PatientPortalService,
    billingOk,
    billingErr,
    resolveBillingSubscription,
    requirePlusForBillingFeature,
    getPatientStep3Status,
    ensureProductsPhase2Tables,
    blockWalletWhenDisabled,
    blockChatWhenDisabled,
    isPatientWalletEnabled,
    isPatientChatEnabled,
    parseBooleanFlag,
    withIdempotency,
    assertPatientOwnsAppointmentOrThrow,
    validatePatientAvailableSlotsQuery,
    validatePatientBookingScheduleBody,
    validatePatientTriageBody,
    requireCsrfForCookieAuth,
    auditBookingEvent,
    botGuard,
    authLimiter,
    otpSendLimiter,
    otpConfirmLimiter,
    listCatalogFromIndex,
    parseProductRef,
  } = deps;

app.get('/api/patient/products/catalog', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const q = String(req.query?.q || '').trim();
    const catalog = String(req.query?.catalog || 'all').trim().toLowerCase();
    const products = listCatalogFromIndex({
      q,
      catalog: ['obf', 'off', 'all'].includes(catalog) ? catalog : 'all',
      limit: req.query?.limit,
      offset: req.query?.offset
    });
    return res.json({ success: true, products });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/products/:id/info', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const product = getIndexedProductByRef(req.params?.id);
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
    const enriched = IngredientEnrichmentService.getEnrichedIngredients(product.id);
    const ingredient_summary = IngredientEnrichmentService.deriveIngredientSummary(enriched);
    return res.json({
      success: true,
      product,
      info: {
        ingredients_enriched: enriched,
        ingredient_summary
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/products/saved-scans', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    let rows = [];
    try {
      rows = db.db.prepare(`
        SELECT id, customer_id, barcode, product_json, source_session_id, scanned_at, updated_at
        FROM customer_products
        WHERE source_session_id = ? OR customer_id = ?
        ORDER BY datetime(scanned_at) DESC, datetime(updated_at) DESC
        LIMIT ?
      `).all(sessionId || '', patientId || '', Math.max(1, Math.min(200, Number(req.query?.limit) || 50)));
    } catch (_) {
      rows = [];
    }
    const scans = rows.map((r) => {
      const product = (() => {
        try { return JSON.parse(r.product_json || '{}'); } catch (_) { return {}; }
      })();
      return {
        id: r.id,
        barcode: r.barcode,
        scanned_at: r.scanned_at || r.updated_at,
        product
      };
    });
    return res.json({ success: true, scans });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/products/informations', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const items = [
      { id: 'educ-1', title: 'How product scoring works', body: 'Scores blend ingredient role, concern tags, and concentration-order heuristics.' },
      { id: 'educ-2', title: 'Why some ingredients are unresolved', body: 'Unresolved tokens are queued for alias expansion and reviewed during weekly enrichment updates.' },
      { id: 'educ-3', title: 'How to use Similar', body: 'Similar matches are ranked by category overlap, ingredient overlap, and concern-tag compatibility.' }
    ];
    return res.json({ success: true, items });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/products/:id/similar', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const source = getIndexedProductByRef(req.params?.id);
    if (!source) return res.status(404).json({ success: false, error: 'Product not found' });
    const catalog = source.catalog;
    const sourceCats = new Set(source.categories_tags || []);
    const sourceIng = new Set(source.ingredients_tags || []);
    const sourceConcerns = new Set(source.ingredients_analysis_tags || []);
    const rows = listCatalogFromIndex({
      q: '',
      catalog,
      limit: 120,
      offset: 0
    }).filter((p) => p.id !== source.id);

    const scoreRows = rows.map((p) => {
      const pCats = new Set(p.categories_tags || []);
      const pIng = new Set(p.ingredients_tags || []);
      const pConcerns = new Set(p.ingredients_analysis_tags || []);
      const overlap = (a, b) => {
        if (!a.size || !b.size) return 0;
        let n = 0;
        for (const x of a) if (b.has(x)) n += 1;
        return n / Math.max(a.size, b.size);
      };
      const categoryScore = overlap(sourceCats, pCats);
      const ingredientScore = overlap(sourceIng, pIng);
      const concernScore = overlap(sourceConcerns, pConcerns);
      const similarity_score = (0.5 * categoryScore) + (0.35 * ingredientScore) + (0.15 * concernScore);
      return {
        ...p,
        similarity_score: Math.round(similarity_score * 1000) / 1000,
        score_breakdown: {
          category_overlap: Math.round(categoryScore * 1000) / 1000,
          ingredient_overlap: Math.round(ingredientScore * 1000) / 1000,
          concern_tag_overlap: Math.round(concernScore * 1000) / 1000
        }
      };
    }).sort((a, b) => b.similarity_score - a.similarity_score);

    return res.json({
      success: true,
      source_product_id: source.id,
      contract: 'category + ingredient overlap + concern tags',
      similar: scoreRows.slice(0, Math.max(1, Math.min(30, Number(req.query?.limit) || 12)))
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/products/lists', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    ensureProductsPhase2Tables();
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    mergePatientProductListsIfNeeded(patientId, sessionId);
    const ownerType = patientId ? 'patient' : 'session';
    const ownerId = patientId || sessionId;
    const rows = db.db.prepare(`
      SELECT id, list_type, list_name, created_at, updated_at
      FROM patient_product_lists
      WHERE owner_type = ? AND owner_id = ?
      ORDER BY datetime(updated_at) DESC
    `).all(ownerType, ownerId);
    const itemRows = db.db.prepare(`
      SELECT list_id, product_ref, note, concern_tags_json, source_scan_id, updated_at
      FROM patient_product_list_items
      WHERE list_id IN (${rows.map(() => '?').join(',') || "''"})
      ORDER BY datetime(updated_at) DESC
    `).all(...rows.map((r) => r.id));
    const byList = new Map();
    for (const it of itemRows) {
      if (!byList.has(it.list_id)) byList.set(it.list_id, []);
      byList.get(it.list_id).push({
        product_ref: it.product_ref,
        note: it.note || null,
        concern_tags: parseJsonSafe(it.concern_tags_json, []),
        source_scan_id: it.source_scan_id || null
      });
    }
    const lists = rows.map((r) => ({ ...r, items: byList.get(r.id) || [] }));
    return res.json({ success: true, lists });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/patient/products/lists', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, async (req, res) => {
  try {
    ensureProductsPhase2Tables();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const listType = String(body.list_type || '').trim().toLowerCase();
    const allowed = new Set(['favorites', 'to_test', 'custom']);
    if (!allowed.has(listType)) return res.status(400).json({ success: false, error: 'Invalid list_type' });
    const listName = String(body.list_name || (listType === 'custom' ? '' : listType)).trim();
    if (!listName) return res.status(400).json({ success: false, error: 'list_name required' });
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    mergePatientProductListsIfNeeded(patientId, sessionId);
    const ownerType = patientId ? 'patient' : 'session';
    const ownerId = patientId || sessionId;
    const existing = db.db.prepare(`
      SELECT id FROM patient_product_lists
      WHERE owner_type = ? AND owner_id = ? AND list_type = ? AND list_name = ?
      LIMIT 1
    `).get(ownerType, ownerId, listType, listName);
    if (existing) return res.json({ success: true, list_id: existing.id, created: false });
    const id = `ppl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.db.prepare(`
      INSERT INTO patient_product_lists (id, owner_type, owner_id, list_type, list_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(id, ownerType, ownerId, listType, listName);
    return res.json({ success: true, list_id: id, created: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/patient/products/lists/:listId/items', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, async (req, res) => {
  try {
    ensureProductsPhase2Tables();
    const listId = String(req.params?.listId || '').trim();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const productRef = String(body.product_ref || '').trim();
    if (!listId || !parseProductRef(productRef)) {
      return res.status(400).json({ success: false, error: 'listId and product_ref (obf:<barcode>|off:<barcode>) are required' });
    }
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    mergePatientProductListsIfNeeded(patientId, sessionId);
    const ownerType = patientId ? 'patient' : 'session';
    const ownerId = patientId || sessionId;
    const list = db.db.prepare(`
      SELECT id FROM patient_product_lists
      WHERE id = ? AND owner_type = ? AND owner_id = ?
      LIMIT 1
    `).get(listId, ownerType, ownerId);
    if (!list) return res.status(404).json({ success: false, error: 'List not found' });
    db.db.prepare(`
      INSERT INTO patient_product_list_items (
        id, list_id, product_ref, note, concern_tags_json, source_scan_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(list_id, product_ref) DO UPDATE SET
        note = COALESCE(excluded.note, patient_product_list_items.note),
        concern_tags_json = COALESCE(excluded.concern_tags_json, patient_product_list_items.concern_tags_json),
        source_scan_id = COALESCE(excluded.source_scan_id, patient_product_list_items.source_scan_id),
        updated_at = datetime('now')
    `).run(
      `ppli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      listId,
      productRef,
      body.note ? String(body.note).slice(0, 800) : null,
      JSON.stringify(Array.isArray(body.concern_tags) ? body.concern_tags : []),
      body.source_scan_id ? String(body.source_scan_id) : null
    );
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
}

module.exports = { registerPatientProductsRoutes };
