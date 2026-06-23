'use strict';

const Metrics = require('../../services/shared/metrics');
const { handlePublicLandingAssistantFromRequest } = require('../../services/kelly/kelly-triage-turn-service');

function registerPublicLandingAssistantRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    validatePatientTriageBody,
    db,
    upsertCustomerProductScan,
    antiSybilGuard,
    requireAdminAuth
  } = deps;

app.post('/api/public/landing-assistant/turn', apiLimiter, validatePatientTriageBody, express.json(), async (req, res) => {
  try {
    const out = await handlePublicLandingAssistantFromRequest(req);
    return res.status(out.status).json(out.json);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/public/landing-assistant/tts-stream', apiLimiter, express.json(), async (req, res) => {
  try {
    const ttsStartMs = Date.now();
    const text = String(req.body?.text || '').trim();
    const lang = String(req.body?.lang || 'en-US').trim();
    if (!text) {
      return res.status(400).json({ success: false, error: 'text required', request_id: req.id });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ success: false, error: 'OPENAI_API_KEY not configured', request_id: req.id });
    }
    const langCode = String(lang || 'en')
      .toLowerCase()
      .split(/[-_]/)[0]
      .trim();
    const voiceByLang = {
      en: process.env.WEB_VOICE_TTS_VOICE_EN || process.env.WEB_VOICE_TTS_VOICE || 'alloy',
      fr: process.env.WEB_VOICE_TTS_VOICE_FR || process.env.WEB_VOICE_TTS_VOICE || 'alloy',
      ru: process.env.WEB_VOICE_TTS_VOICE_RU || process.env.WEB_VOICE_TTS_VOICE || 'alloy',
      sw: process.env.WEB_VOICE_TTS_VOICE_SW || process.env.WEB_VOICE_TTS_VOICE || 'alloy'
    };
    const voice = voiceByLang[langCode] || process.env.WEB_VOICE_TTS_VOICE || 'alloy';
    const model = process.env.WEB_VOICE_TTS_MODEL || 'gpt-4o-mini-tts';
    const input = text.slice(0, 1500);
    const useBufferedTts =
      String(process.env.WEB_VOICE_TTS_BUFFERED || '').toLowerCase() === '1' ||
      String(process.env.WEB_VOICE_TTS_BUFFERED || '').toLowerCase() === 'true';

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-TTS-Voice', voice);
    res.setHeader('X-TTS-Model', model);
    res.setHeader('X-TTS-Lang', langCode || 'en');
    res.setHeader('Access-Control-Expose-Headers', 'X-TTS-Voice, X-TTS-Model, X-TTS-Lang');

    if (useBufferedTts) {
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const tts = await openai.audio.speech.create({
        model,
        voice,
        input
      });
      const upstreamReadyMs = Date.now();
      const buf = Buffer.from(await tts.arrayBuffer());
      const doneMs = Date.now();
      Metrics.increment('voice.metrics.timeline.server_tts.buffered_upstream_ready_ms.total', Math.max(0, upstreamReadyMs - ttsStartMs));
      Metrics.increment('voice.metrics.timeline.server_tts.buffered_upstream_ready_ms.count', 1);
      Metrics.increment('voice.metrics.timeline.server_tts.buffered_total_ms.total', Math.max(0, doneMs - ttsStartMs));
      Metrics.increment('voice.metrics.timeline.server_tts.buffered_total_ms.count', 1);
      return res.status(200).send(buf);
    }

    const { Readable } = require('stream');
    const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        voice,
        input,
        response_format: 'mp3'
      })
    });

    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => '');
      return res.status(502).json({
        success: false,
        error: errBody.slice(0, 300) || `OpenAI TTS upstream ${upstream.status}`,
        request_id: req.id
      });
    }
    const upstreamHeadersMs = Date.now();
    Metrics.increment('voice.metrics.timeline.server_tts.upstream_headers_ms.total', Math.max(0, upstreamHeadersMs - ttsStartMs));
    Metrics.increment('voice.metrics.timeline.server_tts.upstream_headers_ms.count', 1);

    if (!upstream.body) {
      return res.status(502).json({ success: false, error: 'OpenAI TTS returned empty body', request_id: req.id });
    }

    if (typeof Readable.fromWeb !== 'function') {
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.status(200).send(buf);
    }

    const nodeStream = Readable.fromWeb(upstream.body);
    let firstChunkAt = 0;
    const onClientClose = () => {
      try {
        nodeStream.destroy();
      } catch (_) {}
    };
    req.once('close', onClientClose);
    req.once('aborted', onClientClose);
    nodeStream.on('error', (err) => {
      try {
        req.off('close', onClientClose);
        req.off('aborted', onClientClose);
      } catch (_) {}
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message, request_id: req.id });
      } else {
        try {
          res.end();
        } catch (_) {}
      }
    });
    nodeStream.on('data', (chunk) => {
      if (firstChunkAt || !chunk || !chunk.length) return;
      firstChunkAt = Date.now();
      Metrics.increment('voice.metrics.timeline.server_tts.first_chunk_ms.total', Math.max(0, firstChunkAt - ttsStartMs));
      Metrics.increment('voice.metrics.timeline.server_tts.first_chunk_ms.count', 1);
    });
    nodeStream.on('end', () => {
      const doneAt = Date.now();
      try {
        req.off('close', onClientClose);
        req.off('aborted', onClientClose);
      } catch (_) {}
      Metrics.increment('voice.metrics.timeline.server_tts.total_ms.total', Math.max(0, doneAt - ttsStartMs));
      Metrics.increment('voice.metrics.timeline.server_tts.total_ms.count', 1);
    });
    return nodeStream.pipe(res);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});


app.get('/api/public/landing-assistant/results/:sessionId', apiLimiter, async (req, res) => {
  try {
    const SnapshotService = require('../../services/platform/session-result-snapshot-service');
    const sessionId = String(req.params?.sessionId || '').trim();
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId required', request_id: req.id });
    }
    let latest = SnapshotService.getLatestSessionResultSnapshot(sessionId);
    if (!latest) {
      latest = SnapshotService.buildSessionResultSnapshot({ sessionId, source: 'results_api_bootstrap' });
    }
    return res.json({
      success: true,
      session_id: sessionId,
      snapshot_id: latest.snapshot_id,
      session_result_snapshot: latest.snapshot,
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/public/landing-assistant/results/:sessionId/edit', apiLimiter, express.json(), async (req, res) => {
  try {
    const SnapshotService = require('../../services/platform/session-result-snapshot-service');
    const sessionId = String(req.params?.sessionId || '').trim();
    const fieldPath = String(req.body?.field_path || '').trim();
    const reasonForChange = String(req.body?.reason_for_change || '').trim();
    if (!sessionId || !fieldPath) {
      return res.status(400).json({ success: false, error: 'sessionId and field_path required', request_id: req.id });
    }
    const expectedSnapshotId =
      req.body?.expected_snapshot_id != null && req.body?.expected_snapshot_id !== ''
        ? req.body.expected_snapshot_id
        : req.body?.snapshot_id;
    const edited = SnapshotService.applySessionResultEdit({
      sessionId,
      fieldPath,
      userCorrectedValue: req.body?.user_value,
      reasonForChange,
      confidenceAfter: req.body?.confidence_after,
      expectedSnapshotId
    });
    return res.json({
      success: true,
      session_id: sessionId,
      snapshot_id: edited.snapshot_id,
      session_result_snapshot: edited.snapshot,
      request_id: req.id
    });
  } catch (e) {
    if (e && e.code === 'SNAPSHOT_CONFLICT') {
      return res.status(409).json({
        success: false,
        error: 'snapshot_conflict',
        code: 'SNAPSHOT_CONFLICT',
        request_id: req.id
      });
    }
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

const { waitlistRoute } = require('../../database/migrations/037_waitlist');
app.post(
  '/api/public/waitlist',
  apiLimiter,
  express.json(),
  antiSybilGuard(
    'public_waitlist',
    (req) => String(req.body?.email || req.body?.name || '').trim().toLowerCase()
  ),
  waitlistRoute(db.db)
);

app.post('/api/public/risk-appeals', apiLimiter, express.json(), async (req, res) => {
  try {
    const { submitAppeal } = require('../../services/platform/anti-sybil-service');
    const contactEmail = String(req.body?.contact_email || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();
    if (!reason || reason.length < 10) {
      return res.status(400).json({ success: false, error: 'reason must be at least 10 characters' });
    }
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return res.status(400).json({ success: false, error: 'contact_email must be valid when provided' });
    }
    const out = submitAppeal({
      antiSybilEventId: req.body?.anti_sybil_event_id || null,
      contactEmail: contactEmail || null,
      scope: req.body?.scope || null,
      reason
    });
    return res.status(201).json({ success: true, appeal_id: out.id, status: out.status });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/fraud-reviews', requireAdminAuth, async (req, res) => {
  try {
    const status = String(req.query?.status || '').trim() || null;
    const limit = Number(req.query?.limit || 100);
    const items = listFraudReviews({ status, limit });
    return res.json({ success: true, items });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/fraud-reviews/:id/assign', requireAdminAuth, express.json(), async (req, res) => {
  try {
    const out = assignFraudReview({
      reviewId: String(req.params?.id || '').trim(),
      reviewer: String(req.body?.reviewer || req.body?.assigned_to || '').trim(),
      slaMinutes: req.body?.sla_minutes
    });
    if (!out.success) return res.status(404).json({ success: false, error: out.error || 'not_found' });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/fraud-reviews/:id/resolve', requireAdminAuth, express.json(), async (req, res) => {
  try {
    const out = resolveFraudReview({
      reviewId: String(req.params?.id || '').trim(),
      outcome: String(req.body?.outcome || '').trim(),
      note: req.body?.note || ''
    });
    if (!out.success) return res.status(400).json({ success: false, error: out.error || 'resolve_failed' });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/public/landing-assistant/thread-event', apiLimiter, express.json(), async (req, res) => {
  try {
    const sessionId = String(req.body?.session_id || '').trim();
    const text = String(req.body?.text || '').trim();
    const type = String(req.body?.type || 'note').trim();
    if (!sessionId || !text) {
      return res.status(400).json({ success: false, error: 'session_id and text required', request_id: req.id });
    }
    const rawPd = req.body?.product_data;
    const productData =
      rawPd != null && typeof rawPd === 'object' && !Array.isArray(rawPd) ? rawPd : null;
    const { appendLandingContextEvent } = require('../../services/catalog/landing-context-ingest-service');
    const write = appendLandingContextEvent({
      sessionId,
      eventType: type,
      text,
      fileName: req.body?.file_name || null,
      mimeType: req.body?.mime_type || null,
      productData,
      actor: 'user',
      source: String(req.body?.source || 'thread_event').trim() || 'thread_event',
      metadata: {
        request_id: req.id,
        path: req.path
      },
      idempotencyKey: String(req.body?.idempotency_key || req.get('x-idempotency-key') || '').trim(),
      expectedContextVersion: req.body?.context_version
    });
    if (write?.stale_reject) {
      return res.status(409).json({
        success: false,
        error: 'stale_context_version',
        context_version: write.context_version,
        request_id: req.id
      });
    }
    if (type === 'barcode_product_context') {
      try {
        const bc =
          productData && (productData.barcode || productData.code || productData.normalized?.barcode);
        console.log(
          `[landing-assistant] thread-event barcode_product_context session=${String(sessionId).slice(0, 12)}… barcode=${bc || '(none)'}`
        );
      } catch (_) {}
      try {
        const SnapshotService = require('../../services/platform/session-result-snapshot-service');
        SnapshotService.buildSessionResultSnapshot({ sessionId, source: 'barcode_scan_thread_event' });
      } catch (snapErr) {
        console.warn('[landing-assistant] thread-event snapshot:', snapErr?.message || snapErr);
      }
      try {
        const customerSessionId = req.cookies?.customer_session;
        if (customerSessionId) {
          const customerSession = db.getCustomerSession && db.getCustomerSession(customerSessionId);
          const customer = customerSession?.customer_id ? db.getCustomer(customerSession.customer_id) : null;
          if (customer?.id && customer?.email_verified) {
            upsertCustomerProductScan({
              customerId: customer.id,
              merchantId: customer.merchant_id || null,
              landingSessionId: sessionId,
              barcode: productData?.barcode || productData?.code || productData?.normalized?.barcode,
              product: productData,
              scannedAt: new Date().toISOString()
            });
          }
        }
      } catch (claimErr) {
        console.warn('[landing-assistant] thread-event customer_products upsert:', claimErr?.message || claimErr);
      }
    }
    return res.json({
      success: true,
      session_id: sessionId,
      duplicate: !!write?.duplicate,
      context_version: write?.context_version,
      short_term_thread_count: write?.short_term_thread_count
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/public/landing-assistant/voice-metrics/inc', apiLimiter, express.json(), async (req, res) => {
  try {
    const { isAllowedLandingVoiceMetricName } = require('../../services/shared/landing-voice-metrics-contract');
    const sessionId = String(req.body?.session_id || '').trim();
    const metricName = String(req.body?.metric_name || '').trim();
    const value = Math.max(1, Number(req.body?.value || 1));
    if (!sessionId || !metricName || !isAllowedLandingVoiceMetricName(metricName)) {
      return res.status(400).json({ success: false, error: 'Invalid session_id or metric_name', request_id: req.id });
    }
    if (metricName === 'voice.timeline') {
      const points = req.body?.points && typeof req.body.points === 'object' ? req.body.points : {};
      const turnSeq = Math.max(0, Number(req.body?.turn_seq || 0));
      const lang = String(req.body?.lang || '').trim().toLowerCase();
      const detectedLanguage = String(req.body?.detected_language || '').trim().toLowerCase();
      const preferredLanguage = String(req.body?.preferred_language || '').trim().toLowerCase();
      const ttsVoice = String(req.body?.tts_voice || '').trim().toLowerCase();
      const ttsModel = String(req.body?.tts_model || '').trim().toLowerCase();
      const ttsLang = String(req.body?.tts_lang || '').trim().toLowerCase();
      const keys = [
        'stt_final_at',
        'turn_request_sent_at',
        'turn_reply_received_at',
        'tts_request_sent_at',
        'tts_first_byte_at',
        'tts_download_done_at',
        'audio_play_start_at'
      ];
      const safeMs = (n) => {
        const v = Number(n || 0);
        return Number.isFinite(v) && v > 0 ? v : 0;
      };
      const at = Object.create(null);
      for (const k of keys) at[k] = safeMs(points[k]);
      const durations = {
        stt_to_turn_request_ms: at.stt_final_at && at.turn_request_sent_at ? Math.max(0, at.turn_request_sent_at - at.stt_final_at) : 0,
        turn_latency_ms: at.turn_request_sent_at && at.turn_reply_received_at ? Math.max(0, at.turn_reply_received_at - at.turn_request_sent_at) : 0,
        tts_upstream_first_byte_ms: at.tts_request_sent_at && at.tts_first_byte_at ? Math.max(0, at.tts_first_byte_at - at.tts_request_sent_at) : 0,
        tts_download_ms: at.tts_request_sent_at && at.tts_download_done_at ? Math.max(0, at.tts_download_done_at - at.tts_request_sent_at) : 0,
        tts_play_start_after_request_ms: at.tts_request_sent_at && at.audio_play_start_at ? Math.max(0, at.audio_play_start_at - at.tts_request_sent_at) : 0,
        turn_to_audio_start_ms: at.turn_request_sent_at && at.audio_play_start_at ? Math.max(0, at.audio_play_start_at - at.turn_request_sent_at) : 0
      };
      Metrics.increment('voice.metrics.timeline.turns', 1);
      Metrics.increment(`voice.metrics.session.${sessionId}.timeline.turns`, 1);
      if (turnSeq > 0) {
        Metrics.increment(`voice.metrics.session.${sessionId}.timeline.turn.${turnSeq}.seen`, 1);
      }
      if (lang) {
        Metrics.increment(`voice.metrics.timeline.lang.${lang}.turns`, 1);
        Metrics.increment(`voice.metrics.session.${sessionId}.timeline.lang.${lang}.turns`, 1);
      }
      if (detectedLanguage) {
        Metrics.increment(`voice.metrics.timeline.detected_lang.${detectedLanguage}.turns`, 1);
      }
      if (preferredLanguage) {
        Metrics.increment(`voice.metrics.timeline.preferred_lang.${preferredLanguage}.turns`, 1);
      }
      if (ttsVoice) {
        Metrics.increment(`voice.metrics.timeline.voice.${ttsVoice}.turns`, 1);
      }
      if (ttsModel) {
        Metrics.increment(`voice.metrics.timeline.model.${ttsModel}.turns`, 1);
      }
      if (ttsLang) {
        Metrics.increment(`voice.metrics.timeline.tts_lang.${ttsLang}.turns`, 1);
      }
      for (const [name, ms] of Object.entries(durations)) {
        if (!ms) continue;
        Metrics.increment(`voice.metrics.timeline.${name}.total`, ms);
        Metrics.increment(`voice.metrics.timeline.${name}.count`, 1);
        Metrics.increment(`voice.metrics.session.${sessionId}.timeline.${name}.total`, ms);
        Metrics.increment(`voice.metrics.session.${sessionId}.timeline.${name}.count`, 1);
      }
      return res.json({ success: true, request_id: req.id, timeline_recorded: true });
    }
    Metrics.increment(`voice.metrics.${metricName}.count`, value);
    Metrics.increment(`voice.metrics.session.${sessionId}.${metricName}.count`, value);
    return res.json({ success: true, request_id: req.id });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.get('/api/public/landing-assistant/voice-metrics/:sessionId', apiLimiter, async (req, res) => {
  try {
    const sessionId = String(req.params?.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId required', request_id: req.id });
    const all = Metrics.getAll();
    const base = `voice.metrics.session.${sessionId}.`;
    const assistantTurns = Number(all[`${base}assistant_turns`] || 0);
    const assistantWordsTotal = Number(all[`${base}assistant_words_total`] || 0);
    const multiQuestionTurns = Number(all[`${base}multi_question_turns`] || 0);
    const rephrase2Turns = Number(all[`${base}rephrase_within_2_turns`] || 0);
    const interruptions = Number(all[`${base}voice.interruption.count`] || 0);
    const ttfhrMs = Number(all[`${base}time_to_first_helpful_response_ms`] || 0);
    const safeRate = (n, d) => (d > 0 ? n / d : 0);
    const metrics = {
      interruption_rate: safeRate(interruptions, assistantTurns),
      multi_question_turn_rate: safeRate(multiQuestionTurns, assistantTurns),
      rephrase_within_2_turns_rate: safeRate(rephrase2Turns, assistantTurns),
      time_to_first_helpful_response_ms: ttfhrMs || null,
      avg_assistant_words_per_voice_turn: safeRate(assistantWordsTotal, assistantTurns),
      assistant_turns: assistantTurns
    };
    const thresholds = {
      max_interruption_rate: Number(process.env.VOICE_SLO_MAX_INTERRUPTION_RATE || 0.45),
      max_multi_question_turn_rate: Number(process.env.VOICE_SLO_MAX_MULTI_QUESTION_RATE || 0.2),
      max_rephrase_within_2_turns_rate: Number(process.env.VOICE_SLO_MAX_REPHRASE_RATE || 0.25),
      max_time_to_first_helpful_response_ms: Number(process.env.VOICE_SLO_MAX_TTFHR_MS || 12000),
      max_avg_assistant_words_per_voice_turn: Number(process.env.VOICE_SLO_MAX_AVG_WORDS || 32)
    };
    const rollout = {
      interruption_rate_ok: metrics.interruption_rate <= thresholds.max_interruption_rate,
      multi_question_rate_ok: metrics.multi_question_turn_rate <= thresholds.max_multi_question_turn_rate,
      rephrase_rate_ok: metrics.rephrase_within_2_turns_rate <= thresholds.max_rephrase_within_2_turns_rate,
      ttfhr_ok: metrics.time_to_first_helpful_response_ms == null || metrics.time_to_first_helpful_response_ms <= thresholds.max_time_to_first_helpful_response_ms,
      avg_words_ok: metrics.avg_assistant_words_per_voice_turn <= thresholds.max_avg_assistant_words_per_voice_turn
    };
    rollout.accept_for_rollout = Object.values(rollout).every(Boolean);
    return res.json({ success: true, session_id: sessionId, metrics, thresholds, rollout, request_id: req.id });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.get('/api/public/landing-assistant/voice-metrics/dashboard', apiLimiter, async (req, res) => {
  try {
    const all = Metrics.getAll();
    const totals = {
      assistant_turns: Number(all['voice.metrics.assistant_turns'] || 0),
      assistant_words_total: Number(all['voice.metrics.assistant_words_total'] || 0),
      multi_question_turns: Number(all['voice.metrics.multi_question_turns'] || 0),
      rephrase_within_2_turns: Number(all['voice.metrics.rephrase_within_2_turns'] || 0),
      interruption_count: Number(all['voice.metrics.voice.interruption.count'] || 0),
      ttfhr_ms_total: Number(all['voice.metrics.time_to_first_helpful_response_ms_total'] || 0),
      ttfhr_ms_count: Number(all['voice.metrics.time_to_first_helpful_response_ms_count'] || 0)
    };
    const safeRate = (n, d) => (d > 0 ? n / d : 0);
    const kpis = {
      interruption_rate: safeRate(totals.interruption_count, totals.assistant_turns),
      multi_question_turn_rate: safeRate(totals.multi_question_turns, totals.assistant_turns),
      rephrase_within_2_turns_rate: safeRate(totals.rephrase_within_2_turns, totals.assistant_turns),
      time_to_first_helpful_response_ms: safeRate(totals.ttfhr_ms_total, totals.ttfhr_ms_count),
      avg_assistant_words_per_voice_turn: safeRate(totals.assistant_words_total, totals.assistant_turns)
    };
    return res.json({ success: true, totals, kpis, request_id: req.id });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

}

module.exports = { registerPublicLandingAssistantRoutes };
