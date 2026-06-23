'use strict';

function registerPatientShelfRoutes(app, deps) {
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
  } = deps;
  

app.get('/api/patient/shelf/products', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    ensurePatientShelfInventoryColumns();
    const sessionId = req.patientSessionId;
    const rows = loadPatientShelfProductRows(sessionId);
    const products = rows.map((r) => formatShelfProductApiRow(r));
    return res.json({ success: true, products });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.patch('/api/patient/shelf/products/:productId', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, async (req, res) => {
  try {
    ensurePatientShelfInventoryColumns();
    const sessionId = req.patientSessionId;
    const productId = String(req.params.productId || '').trim();
    if (!productId) return res.status(400).json({ success: false, error: 'product id required' });
    const row = db.db.prepare(`SELECT id FROM patient_onboarding_step3_products WHERE id = ? AND session_id = ?`).get(productId, sessionId);
    if (!row) return res.status(404).json({ success: false, error: 'Product not found' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updates = [];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(body, 'opened_date')) {
      const v = body.opened_date == null || body.opened_date === '' ? null : String(body.opened_date).trim();
      if (v && !isIsoDateOnly(v)) return res.status(400).json({ success: false, error: 'opened_date must be YYYY-MM-DD' });
      updates.push('opened_date = ?');
      params.push(v);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'expiry_date')) {
      const v = body.expiry_date == null || body.expiry_date === '' ? null : String(body.expiry_date).trim();
      if (v && !isIsoDateOnly(v)) return res.status(400).json({ success: false, error: 'expiry_date must be YYYY-MM-DD' });
      updates.push('expiry_date = ?');
      params.push(v);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'pao_months')) {
      const n = body.pao_months == null || body.pao_months === '' ? null : Number(body.pao_months);
      if (n != null && (!Number.isFinite(n) || n < 0 || n > 120)) {
        return res.status(400).json({ success: false, error: 'pao_months must be between 0 and 120' });
      }
      updates.push('pao_months = ?');
      params.push(n);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'inventory_status')) {
      const st = String(body.inventory_status || '').trim().toLowerCase();
      if (!['stock', 'opened', 'finished'].includes(st)) {
        return res.status(400).json({ success: false, error: 'inventory_status must be stock, opened, or finished' });
      }
      updates.push('inventory_status = ?');
      params.push(st);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'price_usd')) {
      const p = body.price_usd == null || body.price_usd === '' ? null : Number(body.price_usd);
      if (p != null && (!Number.isFinite(p) || p < 0)) {
        return res.status(400).json({ success: false, error: 'price_usd must be a non-negative number' });
      }
      updates.push('price_usd = ?');
      params.push(p);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'key_ingredients')) {
      const k = body.key_ingredients == null ? null : String(body.key_ingredients).trim().slice(0, 2000);
      updates.push('key_ingredients = ?');
      params.push(k);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'display_color')) {
      const dc = body.display_color == null || body.display_color === '' ? null : String(body.display_color).trim();
      if (dc && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(dc) && !/^hsl\(/i.test(dc)) {
        return res.status(400).json({ success: false, error: 'display_color must be #hex or hsl(...)' });
      }
      updates.push('display_color = ?');
      params.push(dc);
    }

    if (!updates.length) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }
    updates.push('updated_at = datetime(\'now\')');
    params.push(productId, sessionId);
    db.db.prepare(`UPDATE patient_onboarding_step3_products SET ${updates.join(', ')} WHERE id = ? AND session_id = ?`).run(...params);
    const fresh = db.db.prepare(`
      SELECT id, selection_mode, catalog_product_id, custom_product_name, custom_brand, category, usage_time,
        frequency_rule, days_of_week_json, goal, opened_date, expiry_date, pao_months, inventory_status,
        price_usd, key_ingredients, display_color, updated_at
      FROM patient_onboarding_step3_products WHERE id = ? AND session_id = ?
    `).get(productId, sessionId);
    return res.json({ success: true, product: formatShelfProductApiRow(fresh) });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/patient/shelf/products/:productId/link-routine-item', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, async (req, res) => {
  try {
    ensureRoutineTables();
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const productId = String(req.params.productId || '').trim();
    const templateItemId = String(req.body?.template_item_id || '').trim();
    if (!productId || !templateItemId) {
      return res.status(400).json({ success: false, error: 'productId and template_item_id required' });
    }
    const shelfRow = db.db.prepare(`SELECT id FROM patient_onboarding_step3_products WHERE id = ? AND session_id = ?`).get(productId, sessionId);
    if (!shelfRow) return res.status(404).json({ success: false, error: 'Product not found' });
    const whereSql = patientId
      ? `WHERE (patient_id = ? OR session_id = ?) AND is_active = 1`
      : `WHERE session_id = ? AND is_active = 1`;
    const tParams = patientId ? [patientId, sessionId] : [sessionId];
    const template = db.db.prepare(`SELECT id FROM patient_routine_templates ${whereSql} ORDER BY datetime(updated_at) DESC LIMIT 1`).get(...tParams);
    if (!template) return res.status(400).json({ success: false, error_code: 'NO_TEMPLATE', error: 'No active routine template.' });
    const item = db.db.prepare(`SELECT id FROM patient_routine_template_items WHERE id = ? AND template_id = ? AND is_active = 1`).get(templateItemId, template.id);
    if (!item) return res.status(404).json({ success: false, error: 'Template item not found' });
    db.db.prepare(`
      UPDATE patient_routine_template_items
      SET source_type = 'shelf', source_ref_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(productId, templateItemId);
    return res.json({ success: true, template_item_id: templateItemId, shelf_product_id: productId });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
}

module.exports = { registerPatientShelfRoutes };
