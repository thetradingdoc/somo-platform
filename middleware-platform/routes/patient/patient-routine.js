'use strict';

function registerPatientRoutineRoutes(app, deps) {
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
  

app.post('/api/patient/auth/handoff/create', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  try {
    const handoff = require('../../services/patient-auth-handoff-service');
    const created = handoff.createTicket(db, req.patientSessionId);
    recordPatientPortalEvent(req, 'auth_handoff_created', { ticket_prefix: String(created.ticket).slice(0, 12) });
    return res.json({ success: true, ticket: created.ticket, expires_at: created.expires_at });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/patient/auth/handoff/exchange', (req, res, next) => apiLimiter(req, res, next), express.json(), async (req, res) => {
  try {
    const handoff = require('../../services/patient-auth-handoff-service');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = handoff.exchangeTicket(db, body.ticket);
    if (!result.ok) {
      return res.status(400).json({ success: false, error_code: result.error_code, error: result.error });
    }
    const sessionValidation = PatientPortalService.validateSession(result.session_id);
    if (!sessionValidation.valid) {
      return res.status(401).json({ success: false, error_code: 'SESSION_INVALID', error: 'Session is no longer valid.' });
    }
    recordPatientPortalEvent(req, 'auth_handoff_exchanged', { session_id: result.session_id });
    return res.json({ success: true, session_id: result.session_id });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/routine/template', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    ensureRoutineTables();
    ensurePatientShelfInventoryColumns();
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const baseParams = patientId ? [patientId, sessionId] : [sessionId];
    const whereSql = patientId
      ? `WHERE (patient_id = ? OR session_id = ?) AND is_active = 1`
      : `WHERE session_id = ? AND is_active = 1`;
    const template = db.db.prepare(`
      SELECT id, name, start_date, duration_days, repeat_cadence, repeat_days_of_week_json, concern_id, metadata_json, program_week, is_active, created_at, updated_at
      FROM patient_routine_templates
      ${whereSql}
      ORDER BY datetime(updated_at) DESC
      LIMIT 1
    `).get(...baseParams) || null;

    const items = template
      ? db.db.prepare(`
          SELECT id, source_type, source_ref_id, product_name, product_brand, usage_time, frequency_rule, days_of_week_json, goal, step_order, is_active
          FROM patient_routine_template_items
          WHERE template_id = ? AND is_active = 1
          ORDER BY step_order ASC, datetime(created_at) ASC
        `).all(template.id).map((r) => ({
          ...r,
          days_of_week: safeParseJsonArray(r.days_of_week_json)
        }))
      : [];

    const shelfProducts = loadPatientShelfProductRows(sessionId).map((r) => formatShelfProductApiRow(r));

    let metadata = null;
    if (template?.metadata_json) {
      try {
        metadata = JSON.parse(String(template.metadata_json));
      } catch (_) {
        metadata = null;
      }
    }

    return res.json({
      success: true,
      has_template: !!template,
      template: template ? {
        ...template,
        duration_days: Number(template.duration_days) > 0 ? Number(template.duration_days) : 28,
        repeat_cadence: String(template.repeat_cadence || 'daily').toLowerCase() === 'selected_days' ? 'selected_days' : 'daily',
        repeat_days_of_week: safeParseJsonArray(template.repeat_days_of_week_json),
        concern_id: template.concern_id || null,
        metadata,
        items
      } : null,
      shelf_products: shelfProducts
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/patient/routine/template', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, async (req, res) => {
  try {
    ensureRoutineTables();
    const concernRoutineService = require('../../services/platform/concern-routine-service');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const concernId = String(body.concern_id || '').trim();
    let name;
    let items;
    let startDate;
    let durationDays;
    let repeatCadence = 'daily';
    let repeatDaysOfWeek = [];
    let metadataJson = null;
    let concernIdStored = null;
    let programWeek = 1;

    if (concernId) {
      if (!concernRoutineService.VALID_CONCERNS.has(concernId)) {
        return res.status(400).json({ success: false, error_code: 'UNKNOWN_CONCERN', error: 'Unknown concern_id.' });
      }
      startDate = String(body.start_date || '').trim();
      if (startDate && !isIsoDateOnly(startDate)) {
        return res.status(400).json({ success: false, error_code: 'INVALID_START_DATE', error: 'start_date must be YYYY-MM-DD.' });
      }
      const built = concernRoutineService.buildTemplatePayload(concernId, startDate || undefined);
      name = built.name;
      items = built.items;
      startDate = built.start_date;
      durationDays = built.duration_days;
      metadataJson = JSON.stringify(built.metadata_json);
      concernIdStored = built.concern_id;
      programWeek = built.program_week || 1;
    } else {
      name = String(body.name || 'My Routine').trim();
      items = Array.isArray(body.items) ? body.items : [];
      startDate = String(body.start_date || '').trim();
      const durationDaysRaw = Number(body.duration_days);
      durationDays = Number.isFinite(durationDaysRaw) ? Math.max(1, Math.min(365, Math.round(durationDaysRaw))) : 28;
      repeatCadence = String(body.repeat_cadence || 'daily').trim().toLowerCase() === 'selected_days'
        ? 'selected_days'
        : 'daily';
      repeatDaysOfWeek = Array.isArray(body.repeat_days_of_week)
        ? body.repeat_days_of_week.map((d) => String(d || '').trim().toLowerCase()).filter((d) => ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(d))
        : [];
      if (startDate && !isIsoDateOnly(startDate)) {
        return res.status(400).json({ success: false, error_code: 'INVALID_START_DATE', error: 'start_date must be YYYY-MM-DD.' });
      }
      if (repeatCadence === 'selected_days' && repeatDaysOfWeek.length === 0) {
        return res.status(400).json({ success: false, error_code: 'REPEAT_DAYS_REQUIRED', error: 'Choose at least one repeat day.' });
      }
      if (!items.length) {
        return res.status(400).json({ success: false, error_code: 'ITEMS_REQUIRED', error: 'Add at least one routine item or provide concern_id.' });
      }
    }

    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const templateId = `rtpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    db.db.prepare(`UPDATE patient_routine_templates SET is_active = 0, updated_at = datetime('now') WHERE session_id = ?`).run(sessionId);
    db.db.prepare(`
      INSERT INTO patient_routine_templates (
        id, session_id, patient_id, name, start_date, duration_days, repeat_cadence, repeat_days_of_week_json,
        concern_id, metadata_json, program_week, is_active, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(
      templateId,
      sessionId,
      patientId || null,
      name,
      startDate || new Date().toISOString().slice(0, 10),
      durationDays,
      repeatCadence,
      JSON.stringify(repeatDaysOfWeek),
      concernIdStored,
      metadataJson,
      programWeek
    );

    const insertItem = db.db.prepare(`
      INSERT INTO patient_routine_template_items (
        id, template_id, source_type, source_ref_id, product_name, product_brand, usage_time, frequency_rule, days_of_week_json, goal, step_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `);
    items.forEach((it, idx) => {
      const productName = String(it.product_name || '').trim();
      if (!productName) throw new Error(`Routine item ${idx + 1} is missing product_name.`);
      insertItem.run(
        `rti_${templateId}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        templateId,
        String(it.source_type || 'shelf'),
        it.source_ref_id ? String(it.source_ref_id) : null,
        productName,
        it.product_brand ? String(it.product_brand) : null,
        it.usage_time ? String(it.usage_time) : null,
        it.frequency_rule ? String(it.frequency_rule) : null,
        JSON.stringify(Array.isArray(it.days_of_week) ? it.days_of_week : []),
        it.goal ? String(it.goal) : null,
        Number.isFinite(Number(it.step_order)) ? Number(it.step_order) : idx + 1
      );
    });

    recordPatientPortalEvent(req, 'template_created', {
      template_id: templateId,
      items_saved: items.length,
      concern_id: concernIdStored || null
    });
    return res.json({
      success: true,
      template_id: templateId,
      items_saved: items.length,
      concern_id: concernIdStored || null,
      schedule: {
        start_date: startDate || new Date().toISOString().slice(0, 10),
        duration_days: durationDays,
        repeat_cadence: repeatCadence,
        repeat_days_of_week: repeatDaysOfWeek
      }
    });
  } catch (e) {
    return res.status(400).json({ success: false, error_code: 'VALIDATION_ERROR', error: e.message });
  }
});

app.get('/api/patient/routine/phase', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    ensureRoutineTables();
    const concernRoutineService = require('../../services/platform/concern-routine-service');
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const date = String(req.query?.date || '').trim();
    const targetDate = isIsoDateOnly(date) ? date : new Date().toISOString().slice(0, 10);
    const whereSql = patientId
      ? `WHERE (patient_id = ? OR session_id = ?) AND is_active = 1`
      : `WHERE session_id = ? AND is_active = 1`;
    const tParams = patientId ? [patientId, sessionId] : [sessionId];
    const template = db.db.prepare(`
      SELECT id, name, start_date, duration_days, concern_id, metadata_json
      FROM patient_routine_templates
      ${whereSql}
      ORDER BY datetime(updated_at) DESC
      LIMIT 1
    `).get(...tParams);
    if (!template) {
      return res.json({ success: true, has_template: false, phase: null });
    }
    let program = null;
    if (template.metadata_json) {
      try {
        program = JSON.parse(String(template.metadata_json));
      } catch (_) {
        program = null;
      }
    }
    if (!program && template.concern_id) {
      program = concernRoutineService.getConcernProgram(template.concern_id);
    }
    if (!program) {
      return res.status(400).json({ success: false, error_code: 'NO_PROGRAM_METADATA', error: 'Template has no care program metadata.' });
    }
    const phase = concernRoutineService.resolveCurrentPhase(
      program,
      template.start_date || targetDate,
      targetDate
    );
    const items = concernRoutineService.phaseStepsAsTemplateItems(phase, program);
    let meta = {};
    try {
      meta = template.metadata_json ? JSON.parse(String(template.metadata_json)) : {};
    } catch (_) {
      meta = {};
    }
    const syncWeek = Number(phase?.program_week) || 0;
    if (syncWeek > 0 && meta.last_display_sync_week !== syncWeek && items.length) {
      concernRoutineService.syncTemplateDisplayFromPhase(db.db, template.id, items);
      meta.last_display_sync_week = syncWeek;
      db.db.prepare(`UPDATE patient_routine_templates SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(JSON.stringify(meta), template.id);
    }
    const { resolveRoutineDayMode } = require('../../lib/routine-day-mode');
    const dayMode = resolveRoutineDayMode(targetDate);
    return res.json({
      success: true,
      has_template: true,
      target_date: targetDate,
      day_mode: dayMode.mode,
      is_mutable: dayMode.is_mutable,
      allows_photo: dayMode.allows_photo,
      allows_daily_post: dayMode.allows_daily_post,
      template: {
        id: template.id,
        name: template.name,
        concern_id: template.concern_id || program.concern || null,
        start_date: template.start_date,
        duration_days: Number(template.duration_days) || 28
      },
      phase: {
        ...phase,
        key_rules: program.key_rules || [],
        red_flags: program.red_flags || []
      },
      items
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/routine/compare', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    ensureRoutineTables();
    const dateA = String(req.query?.date_a || '').trim();
    const dateB = String(req.query?.date_b || '').trim();
    if (!isIsoDateOnly(dateA) || !isIsoDateOnly(dateB)) {
      return res.status(400).json({ success: false, error_code: 'INVALID_DATE', error: 'date_a and date_b must be YYYY-MM-DD.' });
    }
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const whereSql = patientId
      ? `WHERE (patient_id = ? OR session_id = ?) AND is_active = 1`
      : `WHERE session_id = ? AND is_active = 1`;
    const tParams = patientId ? [patientId, sessionId] : [sessionId];
    const template = db.db.prepare(`
      SELECT id FROM patient_routine_templates ${whereSql} ORDER BY datetime(updated_at) DESC LIMIT 1
    `).get(...tParams);
    if (!template) return res.json({ success: true, has_template: false, day_a: null, day_b: null });
    const { buildCompareDay } = require('../../lib/routine-compare-helper');
    const resolveThumb = (docId) =>
      patientId ? issuePatientDocumentDownloadUrl(req, patientId, docId) : null;
    return res.json({
      success: true,
      has_template: true,
      day_a: buildCompareDay(db.db, template.id, dateA, resolveThumb),
      day_b: buildCompareDay(db.db, template.id, dateB, resolveThumb),
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/routine/layering-check', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    ensureRoutineTables();
    const concernRoutineService = require('../../services/platform/concern-routine-service');
    const { runLayeringCheck } = require('../../lib/routine-layering-check');
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const whereSql = patientId
      ? `WHERE (patient_id = ? OR session_id = ?) AND is_active = 1`
      : `WHERE session_id = ? AND is_active = 1`;
    const tParams = patientId ? [patientId, sessionId] : [sessionId];
    const template = db.db.prepare(`
      SELECT id, start_date, concern_id, metadata_json
      FROM patient_routine_templates ${whereSql} ORDER BY datetime(updated_at) DESC LIMIT 1
    `).get(...tParams);
    if (!template) return res.json({ success: true, has_template: false, verdict: null });
    let program = null;
    if (template.metadata_json) {
      try { program = JSON.parse(String(template.metadata_json)); } catch (_) { program = null; }
    }
    if (!program && template.concern_id) program = concernRoutineService.getConcernProgram(template.concern_id);
    const todayIso = new Date().toISOString().slice(0, 10);
    const phase = program
      ? concernRoutineService.resolveCurrentPhase(program, template.start_date, todayIso)
      : null;
    const steps = program
      ? concernRoutineService.phaseStepsAsTemplateItems(phase, program)
      : [];
    const result = runLayeringCheck({ steps, db: db.db });
    return res.json({ success: true, has_template: true, ...result });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/routine/daily', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    ensureRoutineTables();
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const date = String(req.query?.date || '').trim();
    const targetDate = isIsoDateOnly(date) ? date : new Date().toISOString().slice(0, 10);
    const whereSql = patientId
      ? `WHERE (t.patient_id = ? OR t.session_id = ?) AND t.is_active = 1`
      : `WHERE t.session_id = ? AND t.is_active = 1`;
    const tParams = patientId ? [patientId, sessionId] : [sessionId];
    const template = db.db.prepare(`
      SELECT t.id, t.name
      FROM patient_routine_templates t
      ${whereSql}
      ORDER BY datetime(t.updated_at) DESC
      LIMIT 1
    `).get(...tParams);
    if (!template) return res.json({ success: true, has_template: false, daily_entry: null });

    const dailyEntry = db.db.prepare(`
      SELECT id, entry_date, skin_report, notes, completion_score, created_at, updated_at
      FROM patient_routine_daily_entries
      WHERE template_id = ? AND entry_date = ?
      LIMIT 1
    `).get(template.id, targetDate) || null;
    const itemLogs = dailyEntry
      ? db.db.prepare(`
          SELECT id, template_item_id, completed, notes
          FROM patient_routine_daily_item_logs
          WHERE daily_entry_id = ?
          ORDER BY datetime(created_at) ASC
        `).all(dailyEntry.id)
      : [];
    const media = dailyEntry
      ? db.db.prepare(`
          SELECT id, media_type, patient_document_id, media_url, created_at
          FROM patient_routine_daily_media
          WHERE daily_entry_id = ?
          ORDER BY datetime(created_at) DESC
        `).all(dailyEntry.id)
      : [];

    const { resolveRoutineDayMode } = require('../../lib/routine-day-mode');
    const dayMode = resolveRoutineDayMode(targetDate);
    let skinReportParsed = null;
    if (dailyEntry?.skin_report) {
      try {
        skinReportParsed = JSON.parse(String(dailyEntry.skin_report));
      } catch (_) {
        skinReportParsed = null;
      }
    }

    return res.json({
      success: true,
      has_template: true,
      target_date: targetDate,
      day_mode: dayMode.mode,
      is_mutable: dayMode.is_mutable,
      allows_photo: dayMode.allows_photo,
      allows_daily_post: dayMode.allows_daily_post,
      template: { id: template.id, name: template.name },
      daily_entry: dailyEntry
        ? { ...dailyEntry, skin_report_parsed: skinReportParsed, item_logs: itemLogs, media }
        : null
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/patient/routine/daily', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, async (req, res) => {
  try {
    ensureRoutineTables();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const entryDate = String(body.entry_date || '').trim();
    if (!isIsoDateOnly(entryDate)) {
      return res.status(400).json({ success: false, error_code: 'INVALID_DATE', error: 'entry_date must be YYYY-MM-DD.' });
    }
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const whereSql = patientId
      ? `WHERE (patient_id = ? OR session_id = ?) AND is_active = 1`
      : `WHERE session_id = ? AND is_active = 1`;
    const tParams = patientId ? [patientId, sessionId] : [sessionId];
    const template = db.db.prepare(`
      SELECT id FROM patient_routine_templates
      ${whereSql}
      ORDER BY datetime(updated_at) DESC
      LIMIT 1
    `).get(...tParams);
    if (!template) {
      return res.status(400).json({ success: false, error_code: 'NO_TEMPLATE', error: 'Create a routine template first.' });
    }

    const { resolveRoutineDayMode } = require('../../lib/routine-day-mode');
    const dayMode = resolveRoutineDayMode(entryDate);
    const existingPre = db.db.prepare(`
      SELECT id FROM patient_routine_daily_entries
      WHERE template_id = ? AND entry_date = ?
      LIMIT 1
    `).get(template.id, entryDate);

    if (dayMode.mode === 'historical') {
      return res.status(403).json({
        success: false,
        error_code: 'HISTORICAL_READ_ONLY',
        error: 'This day is read-only. Progress photos can only be added within the last 48 hours.',
        day_mode: dayMode.mode,
      });
    }
    if (dayMode.mode === 'backfill' && existingPre) {
      return res.status(403).json({
        success: false,
        error_code: 'BACKFILL_PHOTO_ONLY',
        error: 'Use a progress photo to log this day. Manual edits are not allowed for backfill.',
        day_mode: dayMode.mode,
      });
    }

    const logs = Array.isArray(body.item_logs) ? body.item_logs : [];
    const completionCount = logs.filter((l) => Number(l.completed) === 1 || l.completed === true).length;
    let completionScore = logs.length ? Math.round((completionCount / logs.length) * 100) : 0;
    if (dayMode.mode === 'backfill') {
      if (logs.some((l) => Number(l.completed) === 1 || l.completed === true)) {
        return res.status(403).json({
          success: false,
          error_code: 'BACKFILL_PHOTO_ONLY',
          error: 'Backfill days accept progress photos only.',
          day_mode: dayMode.mode,
        });
      }
      completionScore = 0;
    }
    const existing = existingPre;
    const dailyEntryId = existing?.id || `rde_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (existing) {
      db.db.prepare(`
        UPDATE patient_routine_daily_entries
        SET skin_report = ?, notes = ?, completion_score = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        body.skin_report ? String(body.skin_report) : null,
        body.notes ? String(body.notes) : null,
        completionScore,
        dailyEntryId
      );
      db.db.prepare(`DELETE FROM patient_routine_daily_item_logs WHERE daily_entry_id = ?`).run(dailyEntryId);
    } else {
      db.db.prepare(`
        INSERT INTO patient_routine_daily_entries (
          id, template_id, session_id, patient_id, entry_date, skin_report, notes, completion_score, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        dailyEntryId,
        template.id,
        sessionId,
        patientId || null,
        entryDate,
        body.skin_report ? String(body.skin_report) : null,
        body.notes ? String(body.notes) : null,
        completionScore
      );
    }

    const insertLog = db.db.prepare(`
      INSERT INTO patient_routine_daily_item_logs (id, daily_entry_id, template_item_id, completed, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    logs.forEach((log, idx) => {
      insertLog.run(
        `rdl_${dailyEntryId}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        dailyEntryId,
        log.template_item_id ? String(log.template_item_id) : null,
        (Number(log.completed) === 1 || log.completed === true) ? 1 : 0,
        log.notes ? String(log.notes) : null
      );
    });

    recordPatientPortalEvent(req, 'daily_log_saved', { daily_entry_id: dailyEntryId, entry_date: entryDate, completion_score: completionScore });
    if (completionScore >= 100) {
      recordPatientPortalEvent(req, 'routine_completed_day', { daily_entry_id: dailyEntryId, entry_date: entryDate });
    }
    return res.json({ success: true, daily_entry_id: dailyEntryId, completion_score: completionScore });
  } catch (e) {
    return res.status(400).json({ success: false, error_code: 'VALIDATION_ERROR', error: e.message });
  }
});

app.post('/api/patient/routine/daily/:id/media-link', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, async (req, res) => {
  try {
    ensureRoutineTables();
    const dailyEntryId = String(req.params?.id || '').trim();
    if (!dailyEntryId) return res.status(400).json({ success: false, error: 'daily entry id is required' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const mediaType = String(body.media_type || 'image').trim();
    const patientDocumentId = body.patient_document_id ? String(body.patient_document_id).trim() : null;
    const mediaUrl = body.media_url ? String(body.media_url).trim() : null;
    if (!patientDocumentId && !mediaUrl) {
      return res.status(400).json({ success: false, error_code: 'MEDIA_REQUIRED', error: 'patient_document_id or media_url is required.' });
    }
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const entry = db.db.prepare(`SELECT id, patient_id, session_id FROM patient_routine_daily_entries WHERE id = ? LIMIT 1`).get(dailyEntryId);
    if (!entry) return res.status(404).json({ success: false, error: 'Daily entry not found.' });
    const sessionId = String(req.patientSessionId || '');
    const ownsEntry = patientId
      ? (String(entry.patient_id || '') === String(patientId) || String(entry.session_id || '') === sessionId)
      : String(entry.session_id || '') === sessionId;
    if (!ownsEntry) {
      recordPatientPortalEvent(req, 'daily_media_link_forbidden', { daily_entry_id: dailyEntryId });
      return res.status(403).json({ success: false, error: 'Not allowed to modify this daily entry.' });
    }

    const mediaId = `rdm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.db.prepare(`
      INSERT INTO patient_routine_daily_media (id, daily_entry_id, media_type, patient_document_id, media_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(mediaId, dailyEntryId, mediaType, patientDocumentId, mediaUrl);
    recordPatientPortalEvent(req, 'picture_of_day_linked', { daily_entry_id: dailyEntryId, media_id: mediaId });
    return res.json({ success: true, media_id: mediaId });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/patient/routine/daily/:id/photo', (req, res, next) => apiLimiter(req, res, next), parseBillingDocumentUpload, requirePatientSession, async (req, res) => {
  let mediaId = null;
  try {
    ensureRoutineTables();
    const dailyEntryId = String(req.params?.id || '').trim();
    if (!dailyEntryId) return res.status(400).json({ success: false, error: 'daily entry id is required' });
    const uploadFile = req.file || (Array.isArray(req.files) ? req.files[0] : null);
    if (!uploadFile || !uploadFile.buffer) {
      return res.status(400).json({ success: false, error_code: 'FILE_REQUIRED', error: 'Photo file is required.' });
    }

    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const entry = db.db.prepare(`
      SELECT e.id, e.entry_date, e.template_id, e.patient_id, e.session_id, e.completion_score
      FROM patient_routine_daily_entries e
      WHERE e.id = ?
      LIMIT 1
    `).get(dailyEntryId);
    if (!entry) return res.status(404).json({ success: false, error: 'Daily entry not found.' });
    const ownsEntry = patientId
      ? (String(entry.patient_id || '') === String(patientId) || String(entry.session_id || '') === sessionId)
      : String(entry.session_id || '') === sessionId;
    if (!ownsEntry) return res.status(403).json({ success: false, error: 'Not allowed to modify this daily entry.' });

    const { resolveRoutineDayMode } = require('../../lib/routine-day-mode');
    const dayMode = resolveRoutineDayMode(entry.entry_date);
    if (!dayMode.allows_photo) {
      return res.status(403).json({
        success: false,
        error_code: 'HISTORICAL_READ_ONLY',
        error: 'This day is read-only. Progress photos can only be added within the last 48 hours.',
        day_mode: dayMode.mode,
      });
    }

    const gcsBillingStorage = require('../../services/gcs-billing-storage');
    const uploaded = await gcsBillingStorage.uploadBuffer({
      buffer: uploadFile.buffer,
      contentType: uploadFile.mimetype || 'image/jpeg',
      patientId: patientId || sessionId || 'session',
      fileName: uploadFile.originalname || `routine-${dailyEntryId}.jpg`,
    });
    const storageRef = uploaded.storageRef;
    mediaId = `rdm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.db.prepare(`
      INSERT INTO patient_routine_daily_media (id, daily_entry_id, media_type, patient_document_id, media_url, created_at, updated_at)
      VALUES (?, ?, 'image', NULL, ?, datetime('now'), datetime('now'))
    `).run(mediaId, dailyEntryId, storageRef);

    const template = db.db.prepare(`
      SELECT id, name, start_date, concern_id, metadata_json
      FROM patient_routine_templates
      WHERE id = ?
      LIMIT 1
    `).get(entry.template_id);
    const concernRoutineService = require('../../services/platform/concern-routine-service');
    let program = null;
    if (template?.metadata_json) {
      try {
        program = JSON.parse(String(template.metadata_json));
      } catch (_) {
        program = null;
      }
    }
    if (!program && template?.concern_id) {
      program = concernRoutineService.getConcernProgram(template.concern_id);
    }
    let phaseSnap = null;
    if (program) {
      phaseSnap = concernRoutineService.resolveCurrentPhase(program, template.start_date, entry.entry_date);
    }

    let symptomTags = [];
    try {
      const rawSym = req.body?.symptom_tags ?? req.body?.symptoms;
      if (rawSym) {
        const parsed = typeof rawSym === 'string' ? JSON.parse(rawSym) : rawSym;
        if (Array.isArray(parsed)) symptomTags = parsed;
      }
    } catch (_) {}

    const { applyPhotoDayCompletion } = require('../../lib/routine-photo-day');
    const completion = applyPhotoDayCompletion({
      db: db.db,
      dailyEntryId,
      templateId: entry.template_id,
      entryDate: entry.entry_date,
      phaseSnap,
      program: program || {},
      concernRoutineService,
      storageRef,
      symptomTags,
    });

    recordPatientPortalEvent(req, 'routine_photo_uploaded', {
      daily_entry_id: dailyEntryId,
      media_id: mediaId,
      program_week: completion.skinReport.program_week,
      day_mode: completion.dayMode,
    });
    recordPatientPortalEvent(req, 'routine_completed_day', {
      daily_entry_id: dailyEntryId,
      entry_date: entry.entry_date,
      logged_via: 'photo',
      day_mode: completion.dayMode,
    });
    return res.json({
      success: true,
      media_id: mediaId,
      storage_ref: storageRef,
      completion_score: 100,
      day_mode: completion.dayMode,
      skin_report: completion.skinReport,
      assistant_summary: completion.assistantSummary,
    });
  } catch (e) {
    if (mediaId) {
      try {
        db.db.prepare(`DELETE FROM patient_routine_daily_media WHERE id = ?`).run(mediaId);
      } catch (_) {}
    }
    return res.status(500).json({ success: false, error_code: 'PHOTO_UPLOAD_FAILED', error: e.message });
  }
});

app.get('/api/patient/journal/calendar-range', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    ensureRoutineTables();
    ensureBillingTables();
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const startRaw = String(req.query?.start || '').trim();
    const endRaw = String(req.query?.end || '').trim();
    const tz = String(req.query?.timezone || '').trim() || 'UTC';

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultStart = isoFromLocalDate(currentMonthStart);
    const defaultEnd = isoFromLocalDate(new Date(now.getFullYear(), now.getMonth() + 2, 0));
    const startIso = isIsoDateOnly(startRaw) ? startRaw : defaultStart;
    const endIso = isIsoDateOnly(endRaw) ? endRaw : defaultEnd;
    const startDate = localDateFromIso(startIso);
    const endDate = localDateFromIso(endIso);
    if (!startDate || !endDate || startDate > endDate) {
      return res.status(400).json({ success: false, error_code: 'INVALID_RANGE', error: 'start/end must be valid YYYY-MM-DD and start <= end.' });
    }
    const spanDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    if (spanDays > 186) {
      return res.status(400).json({ success: false, error_code: 'RANGE_TOO_LARGE', error: 'Range cannot exceed 186 days.' });
    }

    const billingAggRows = fetchBillingAggregatesByDay(db.db, { patientId, sessionId, startIso, endIso });
    const billingByDate = new Map(billingAggRows.map((r) => [String(r.service_date), r]));

    const includeEmptyDaysRaw = String(req.query?.include_empty_days ?? '1').trim().toLowerCase();
    const includeEmptyDays = !['0', 'false', 'no', 'off', 'legacy'].includes(includeEmptyDaysRaw);

    const billing_calendar_contract = {
      null_service_date_behavior:
        'Events with null or non-YYYY-MM-DD service_date are excluded from per-day aggregates; they still appear in GET /api/patient/billing/events.',
      day_status_priority:
        'If any event on that day has status due, the day is due. Else if every event on that day is paid, the day is paid. Else the day is review (mixed or needs_review, etc.).',
      no_template_days_behavior:
        'When has_template is false, days defaults to a full range with billing_* fields per day. For legacy clients expecting an empty days array, pass include_empty_days=0 (or false/no/off/legacy).',
      include_empty_days_applied: includeEmptyDays,
    };

    const mergeBillingIntoDay = (iso, base) => ({ ...base, ...fieldsFromSqlAggRow(billingByDate.get(iso)) });

    const whereSql = patientId
      ? `WHERE (patient_id = ? OR session_id = ?) AND is_active = 1`
      : `WHERE session_id = ? AND is_active = 1`;
    const tParams = patientId ? [patientId, sessionId] : [sessionId];
    const template = db.db.prepare(`
      SELECT id, name, start_date, duration_days, repeat_cadence, repeat_days_of_week_json, concern_id, metadata_json
      FROM patient_routine_templates
      ${whereSql}
      ORDER BY datetime(updated_at) DESC
      LIMIT 1
    `).get(...tParams);
    if (!template) {
      const days = includeEmptyDays
        ? enumerateIsoDates(startIso, endIso).map((iso) =>
            mergeBillingIntoDay(iso, {
              date: iso,
              is_routine_day: false,
              has_entry: false,
              completion_score: 0,
              has_media: false,
              thumbnail_url: null,
              patient_document_id: null,
              media_url: null,
            })
          )
        : [];
      return res.json({
        success: true,
        model_version: 2,
        billing_calendar_contract,
        timezone: tz,
        has_template: false,
        template: null,
        range: { start: startIso, end: endIso, days: spanDays },
        days,
      });
    }

    const entries = db.db.prepare(`
      SELECT id, entry_date, completion_score, skin_report
      FROM patient_routine_daily_entries
      WHERE template_id = ? AND entry_date BETWEEN ? AND ?
      ORDER BY entry_date ASC
    `).all(template.id, startIso, endIso);
    const entryByDate = new Map(entries.map((e) => [e.entry_date, e]));
    const mediaRows = db.db.prepare(`
      SELECT e.entry_date, m.patient_document_id, m.media_url, m.created_at
      FROM patient_routine_daily_media m
      JOIN patient_routine_daily_entries e ON e.id = m.daily_entry_id
      WHERE e.template_id = ? AND e.entry_date BETWEEN ? AND ?
      ORDER BY e.entry_date ASC, datetime(m.created_at) DESC
    `).all(template.id, startIso, endIso);
    const mediaByDate = new Map();
    for (const m of mediaRows) {
      if (!m || !m.entry_date || mediaByDate.has(m.entry_date)) continue;
      mediaByDate.set(m.entry_date, m);
    }

    const cadence = String(template.repeat_cadence || 'daily').toLowerCase() === 'selected_days' ? 'selected_days' : 'daily';
    const selectedDays = new Set(safeParseJsonArray(template.repeat_days_of_week_json).map((d) => String(d || '').toLowerCase()));
    const tplStart = localDateFromIso(String(template.start_date || '').trim() || startIso);
    const tplDuration = Math.max(1, Math.min(365, Number(template.duration_days) || 28));
    const tplEnd = new Date(tplStart.getTime());
    tplEnd.setDate(tplEnd.getDate() + tplDuration - 1);
    const concernRoutineService = require('../../services/platform/concern-routine-service');
    let careProgram = null;
    if (template.metadata_json) {
      try {
        careProgram = JSON.parse(String(template.metadata_json));
      } catch (_) {
        careProgram = null;
      }
    }
    if (!careProgram && template.concern_id) {
      careProgram = concernRoutineService.getConcernProgram(template.concern_id);
    }
    const tplStartIso = String(template.start_date || '').trim() || startIso;
    const { resolveRoutineDayMode } = require('../../lib/routine-day-mode');
    const { enrichRoutineCalendarDay } = require('../../lib/routine-calendar-enrich');
    const concernId = String(template.concern_id || careProgram?.concern || '').trim() || null;

    const days = enumerateIsoDates(startIso, endIso).map((iso) => {
      const d = localDateFromIso(iso);
      const inWindow = !!d && d >= tplStart && d <= tplEnd;
      const isRoutineDay = inWindow && (cadence === 'daily' || selectedDays.has(weekdayKeyForIsoLocal(iso)));
      const e = entryByDate.get(iso);
      const m = mediaByDate.get(iso);
      const patientDocumentId = m && m.patient_document_id ? String(m.patient_document_id) : null;
      const thumbnailUrl = m && m.media_url
        ? String(m.media_url)
        : (patientId && patientDocumentId ? issuePatientDocumentDownloadUrl(req, patientId, patientDocumentId) : null);
      const dayMode = resolveRoutineDayMode(iso);
      const base = {
        date: iso,
        is_routine_day: !!isRoutineDay,
        has_entry: !!e,
        completion_score: e ? Math.max(0, Math.min(100, Number(e.completion_score) || 0)) : 0,
        has_media: !!m,
        thumbnail_url: thumbnailUrl || null,
        patient_document_id: patientDocumentId,
        media_url: m && m.media_url ? String(m.media_url) : null,
        day_mode: dayMode.mode,
      };
      const enriched = enrichRoutineCalendarDay(base, {
        careProgram: isRoutineDay ? careProgram : null,
        tplStartIso,
        concernId,
        entryRow: e || null,
      });
      return mergeBillingIntoDay(iso, enriched);
    });

    return res.json({
      success: true,
      model_version: 2,
      billing_calendar_contract,
      timezone: tz,
      has_template: true,
      template: {
        id: template.id,
        name: template.name,
        start_date: template.start_date,
        duration_days: tplDuration,
        repeat_cadence: cadence,
        repeat_days_of_week: Array.from(selectedDays),
      },
      range: { start: startIso, end: endIso, days: spanDays },
      days,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error_code: 'SERVER_ERROR', error: e.message });
  }
});

app.get('/api/patient/home/progress-summary', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    ensureRoutineTables();
    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    const whereSql = patientId
      ? `WHERE (patient_id = ? OR session_id = ?) AND is_active = 1`
      : `WHERE session_id = ? AND is_active = 1`;
    const params = patientId ? [patientId, sessionId] : [sessionId];
    const template = db.db.prepare(`
      SELECT id, name, start_date, concern_id, metadata_json
      FROM patient_routine_templates
      ${whereSql}
      ORDER BY datetime(updated_at) DESC
      LIMIT 1
    `).get(...params);
    if (!template) {
      return res.json({
        success: true,
        has_template: false,
        summary: {
          adherence_pct: 0,
          upcoming_checkins: 0,
          product_uses_logged: 0,
          in_progress: 0,
          today_logged: false,
          upcoming: 0,
          total_tasks: 0
        },
        cards: []
      });
    }
    const concernRoutineService = require('../../services/platform/concern-routine-service');
    let program = null;
    if (template.metadata_json) {
      try { program = JSON.parse(String(template.metadata_json)); } catch (_) { program = null; }
    }
    if (!program && template.concern_id) program = concernRoutineService.getConcernProgram(template.concern_id);
    const todayIsoProgress = new Date().toISOString().slice(0, 10);
    const phaseNow = program
      ? concernRoutineService.resolveCurrentPhase(program, template.start_date, todayIsoProgress)
      : null;
    const phaseItems = program && phaseNow
      ? concernRoutineService.phaseStepsAsTemplateItems(phaseNow, program)
      : [];
    const items = db.db.prepare(`
      SELECT id, product_name, usage_time, goal, step_order
      FROM patient_routine_template_items
      WHERE template_id = ? AND is_active = 1
      ORDER BY step_order ASC, datetime(created_at) ASC
    `).all(template.id);
    const displayItems = phaseItems.length
      ? phaseItems.map((row, idx) => ({
          id: `phase_${idx}`,
          product_name: row.product_name,
          usage_time: row.usage_time,
          goal: row.goal,
          step_order: row.step_order || idx + 1,
        }))
      : items;
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + 6);
    const startIso = now.toISOString().slice(0, 10);
    const endIso = end.toISOString().slice(0, 10);
    const weekEntries = db.db.prepare(`
      SELECT id, entry_date, completion_score
      FROM patient_routine_daily_entries
      WHERE template_id = ? AND entry_date BETWEEN ? AND ?
      ORDER BY entry_date ASC
    `).all(template.id, startIso, endIso);
    const entryByDate = new Map(weekEntries.map((r) => [r.entry_date, r]));
    const enumerateDates = (fromIso, toIso) => {
      const out = [];
      let d = new Date(`${fromIso}T12:00:00.000Z`);
      const endD = new Date(`${toIso}T12:00:00.000Z`);
      while (d <= endD) {
        out.push(d.toISOString().slice(0, 10));
        d = new Date(d.getTime());
        d.setUTCDate(d.getUTCDate() + 1);
      }
      return out;
    };
    const weekDates = enumerateDates(startIso, endIso);
    const nDays = weekDates.length || 7;
    const scoreFor = (iso) => {
      const row = entryByDate.get(iso);
      return row ? Math.max(0, Math.min(100, Number(row.completion_score) || 0)) : 0;
    };
    const adherencePct = nDays
      ? Math.round(weekDates.reduce((acc, iso) => acc + scoreFor(iso), 0) / nDays)
      : 0;
    let upcomingCheckins = 0;
    for (const iso of weekDates) {
      const row = entryByDate.get(iso);
      if (!row || scoreFor(iso) < 100) upcomingCheckins += 1;
    }
    const futureDates = weekDates.slice(1);
    let upcoming = 0;
    for (const iso of futureDates) {
      const row = entryByDate.get(iso);
      if (!row || scoreFor(iso) < 100) upcoming += 1;
    }
    const completedItemLogs = db.db.prepare(`
        SELECT COUNT(*) AS n
        FROM patient_routine_daily_item_logs l
        INNER JOIN patient_routine_daily_entries e ON e.id = l.daily_entry_id
        WHERE e.template_id = ? AND e.entry_date BETWEEN ? AND ? AND (l.completed = 1 OR l.completed = true)
      `).get(template.id, startIso, endIso);
    const todayIso = weekDates[0] || startIso;
    const todayEntry = entryByDate.get(todayIso);
    const todayLogged = todayEntry
      ? Math.max(0, Math.min(100, Number(todayEntry.completion_score) || 0)) >= 100
      : false;
    let inProgress = 0;
    if (!displayItems.length) {
      inProgress = 0;
    } else if (!todayEntry) {
      inProgress = displayItems.length;
    } else if (todayLogged) {
      inProgress = 0;
    } else {
      const logsToday = db.db.prepare(`
          SELECT template_item_id, completed
          FROM patient_routine_daily_item_logs
          WHERE daily_entry_id = ?
        `).all(todayEntry.id);
      const done = new Set(
        logsToday
          .filter((l) => Number(l.completed) === 1 || l.completed === true)
          .map((l) => l.template_item_id)
      );
      inProgress = displayItems.filter((it) => !done.has(it.id)).length;
    }
    const itemDays = db.db.prepare(`
        SELECT l.template_item_id AS id, COUNT(DISTINCT e.entry_date) AS days_done
        FROM patient_routine_daily_item_logs l
        INNER JOIN patient_routine_daily_entries e ON e.id = l.daily_entry_id
        WHERE e.template_id = ? AND e.entry_date BETWEEN ? AND ? AND (l.completed = 1 OR l.completed = true)
        GROUP BY l.template_item_id
      `).all(template.id, startIso, endIso);
    const photoCompleteDaysRow = db.db.prepare(`
        SELECT COUNT(DISTINCT entry_date) AS n
        FROM patient_routine_daily_entries
        WHERE template_id = ? AND entry_date BETWEEN ? AND ? AND completion_score >= 100
      `).get(template.id, startIso, endIso);
    const photoCompleteDays = Number(photoCompleteDaysRow?.n) || 0;
    const daysByItem = new Map(itemDays.map((r) => [r.id, Number(r.days_done) || 0]));
    const phaseLabelNow = phaseNow?.label ? String(phaseNow.label) : null;
    const cards = displayItems.length
      ? [
          {
            id: 'week_routine',
            title: phaseLabelNow ? `This week · ${phaseLabelNow}` : 'This week’s routine',
            subtitle: phaseNow?.expect || phaseNow?.focus || 'One progress photo marks your day complete.',
            date_label: 'Last 7 days',
            progress_pct: adherencePct,
            days_left: Math.max(0, upcomingCheckins),
            days_window: nDays,
          },
          ...displayItems.slice(0, 4).map((it, idx) => ({
            id: it.id,
            title: it.product_name || `Step ${idx + 1}`,
            subtitle: it.goal || String(it.usage_time || 'routine').toUpperCase(),
            date_label: phaseLabelNow ? `Week ${phaseNow.program_week}` : 'Current phase',
            progress_pct: adherencePct,
            days_left: 0,
            days_window: nDays,
          })),
        ]
      : [];
    return res.json({
      success: true,
      has_template: true,
      template: { id: template.id, name: template.name },
      summary: {
        adherence_pct: adherencePct,
        upcoming_checkins: upcomingCheckins,
        product_uses_logged: Number(completedItemLogs.n) || 0,
        in_progress: inProgress,
        today_logged: todayLogged,
        upcoming,
        total_tasks: displayItems.length
      },
      cards
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
}

module.exports = { registerPatientRoutineRoutes };
