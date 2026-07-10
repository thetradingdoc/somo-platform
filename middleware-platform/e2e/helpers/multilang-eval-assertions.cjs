'use strict';

const { buildAiDisclosureLine } = require('../../services/call-opener-resolver');
const { lookupSessionEnrichment } = require('../../services/dashboard-call-enrichment');
const { normalizeDisposition } = require('../../services/disposition-taxonomy');

const PHI_PATTERNS = [
  { id: 'full_ssn', re: /\b\d{3}-\d{2}-\d{4}\b/, label: 'full SSN in transcript' },
  { id: 'card_pan', re: /\b(?:\d[ -]*?){13,19}\b/, label: 'card number pattern in transcript' },
  {
    id: 'full_dob',
    re: /\b(0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}\b/,
    label: 'full DOB (MM/DD/YYYY) in transcript'
  }
];

const BOOKING_FAILURE_RE =
  /unable to complete|not able to complete|connect you with|front desk to finish|could not complete that booking/i;
const PAYMENT_LINK_RE =
  /\b(link|sms|text message|text you|envié|enlace|ссылк|отправил)\b/i;
const DOLLAR_AMOUNT_RE = /\$\s*\d+(?:\.\d{2})?/;
const ENGLISH_SUCCESS_ON_NON_EN_RE =
  /thanks — i verified your coverage|i verified your coverage|your appointment is confirmed/i;

const LOCALE_HINTS = {
  es: /[áéíóúñ¿¡]|cita|copago|envié|verifiqu|confirmad|limpieza|gracias/i,
  ru: /[а-яё]/i,
  zh: /[\u4e00-\u9fff]|预约|取消|谢谢|付款|链接/i,
  en: /\b(the|your|appointment|coverage|verified|link)\b/i
};

function localeFromScenario(scenario) {
  return String(scenario.locale || scenario.lang || 'en').slice(0, 2);
}

function transcriptText(result) {
  const parts = [];
  for (const turn of result.transcript || []) {
    if (turn.text) parts.push(String(turn.text));
    if (turn.reply) parts.push(String(turn.reply));
  }
  if (result.finalReply) parts.push(String(result.finalReply));
  return parts.join('\n');
}

function assistantTranscriptText(result) {
  const parts = [];
  for (const turn of result.transcript || []) {
    const role = String(turn.role || turn.speaker || '').toLowerCase();
    if (role === 'assistant' || role === 'agent' || role === 'kelly') {
      if (turn.text) parts.push(String(turn.text));
      if (turn.reply) parts.push(String(turn.reply));
    }
  }
  if (result.finalReply) parts.push(String(result.finalReply));
  return parts.join('\n');
}

function firstAssistantTurn(result) {
  for (const turn of result.transcript || []) {
    const role = String(turn.role || turn.speaker || '').toLowerCase();
    if (role === 'assistant' || role === 'agent' || role === 'kelly') {
      return String(turn.text || turn.reply || '');
    }
  }
  return String(result.finalReply || '');
}

function finalAssistantTurn(result) {
  const turns = result.transcript || [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const role = String(turn.role || turn.speaker || '').toLowerCase();
    if (role === 'assistant' || role === 'agent' || role === 'kelly') {
      return String(turn.text || turn.reply || '');
    }
  }
  return String(result.finalReply || '');
}

function truthyMeta(val) {
  return val === true || val === 1 || val === '1' || val === 'true';
}

function isCopayPaymentScenario(scenario) {
  return (
    scenario?.copayPayment === true &&
    (scenario.evalTags || []).includes('copay_payment')
  );
}

function readRailsFlags(dbModule, sessionId) {
  if (!dbModule?.db || !sessionId) return {};
  try {
    const row = dbModule.db
      .prepare(
        `SELECT flags_json FROM kelly_rails_session_projection WHERE session_id = ? LIMIT 1`
      )
      .get(sessionId);
    if (!row?.flags_json) return {};
    return typeof row.flags_json === 'string' ? JSON.parse(row.flags_json) : row.flags_json || {};
  } catch (_) {
    return {};
  }
}

function getPaymentLinkEventPayload(dbModule, sessionId) {
  if (!dbModule?.db || !sessionId) return null;
  try {
    const row = dbModule.db
      .prepare(
        `SELECT payload_json FROM kelly_call_events
         WHERE (session_id = ? OR call_id = ?) AND event_type = 'payment_link_sent'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(sessionId, sessionId);
    if (!row?.payload_json) return null;
    return typeof row.payload_json === 'string'
      ? JSON.parse(row.payload_json)
      : row.payload_json || {};
  } catch (_) {
    return null;
  }
}

function hasPaymentLinkEvent(dbModule, sessionId) {
  return !!getPaymentLinkEventPayload(dbModule, sessionId);
}

const SMS_COMMERCE_RE = /complete your order/i;
const SMS_LOCALE_MARKERS = {
  en: /\b(copay|pay securely|payment)\b/i,
  es: /\b(copago|enlace|pagar|segura)\b/i,
  ru: /(копай|оплат|ссылк)/i,
  zh: /(自付|支付|链接|安全)/
};

function checkPaymentSmsCoherence(scenario, sessionId, dbModule) {
  if (!isCopayPaymentScenario(scenario)) return null;
  const payload = getPaymentLinkEventPayload(dbModule, sessionId);
  const body =
    payload?.sms_body ||
    (() => {
      try {
        const KellyToolExecutor = require('../../services/kelly-tool-executor');
        return KellyToolExecutor._getSessionMeta(sessionId, 'rcm_pay_sms_body');
      } catch (_) {
        return null;
      }
    })();
  if (!body) {
    return {
      pass: false,
      check: 'copay payment SMS body captured on payment_link_sent',
      got: { sms_body: null }
    };
  }
  const lang = localeFromScenario(scenario);
  const localeMarker = SMS_LOCALE_MARKERS[lang] || SMS_LOCALE_MARKERS.en;
  const findings = [
    {
      pass: !/undefined/i.test(body),
      check: 'copay SMS: no undefined template leak',
      got: body.slice(0, 200)
    },
    {
      pass: !SMS_COMMERCE_RE.test(body),
      check: 'copay SMS: no commerce checkout copy',
      got: body.slice(0, 200)
    },
    {
      pass: localeMarker.test(body),
      check: `copay SMS: locale-appropriate copy (${lang})`,
      got: body.slice(0, 200)
    },
    {
      pass: /\$\s*\d+(?:\.\d{2})?/.test(body),
      check: 'copay SMS: dollar amount present',
      got: body.slice(0, 200)
    }
  ];
  const pass = findings.every((f) => f.pass);
  return { pass, check: 'copay payment SMS coherence (H5)', got: body.slice(0, 240), subchecks: findings };
}

function disclosurePatterns(locale) {
  const line = buildAiDisclosureLine(locale);
  const patterns = [line];
  const loc = String(locale || 'en').slice(0, 2);
  if (loc === 'es') {
    patterns.push(/asistente automatizado/i, /puede ser grabada/i);
  } else if (loc === 'ru') {
    patterns.push(/автоматическим помощником/i, /может записываться/i);
  } else {
    patterns.push(/automated assistant/i, /may be recorded/i);
  }
  return patterns;
}

function checkReschedule(scenario, tools) {
  if (!scenario.expectReschedule) return null;
  const hasReschedule = tools.includes('reschedule_appointment');
  const hasLegacy =
    tools.includes('cancel_appointment') && tools.includes('schedule_appointment');
  return {
    pass: hasReschedule || hasLegacy,
    check: 'reschedule via reschedule_appointment or cancel+schedule',
    got: tools
  };
}

function openerTextFromEvents(dbModule, sessionId) {
  if (!dbModule?.db || !sessionId) return null;
  try {
    const row = dbModule.db
      .prepare(
        `SELECT payload_json FROM kelly_call_events
         WHERE (session_id = ? OR call_id = ?) AND event_type = 'call_opener_used'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(sessionId, sessionId);
    if (!row) return null;
    const p =
      typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json || {};
    return p.opener_text || p.text || null;
  } catch (_) {
    return null;
  }
}

function checkAiDisclosure(scenario, result, sessionId, dbModule) {
  if (!scenario.expectAiDisclosure) return null;
  const locale = localeFromScenario(scenario);
  const opener = openerTextFromEvents(dbModule, sessionId) || firstAssistantTurn(result);
  const patterns = disclosurePatterns(locale);
  const hit = patterns.some((p) =>
    typeof p === 'string' ? opener.toLowerCase().includes(p.toLowerCase()) : p.test(opener)
  );
  const mixedDisclosure =
    locale === 'es' &&
    /asistente automatizado|puede ser grabada/i.test(opener) &&
    /automated assistant|may be recorded/i.test(opener);
  const mixedOpenerLocale =
    (locale === 'es' || locale === 'ru') &&
    /^(hi,|hello|thank you for calling)/i.test(opener.trim()) &&
    (LOCALE_HINTS[locale]?.test(opener) || /asistente automatizado|автоматическим помощником/i.test(opener));
  return {
    pass: hit && !mixedDisclosure && !mixedOpenerLocale,
    check: `AI disclosure in call language (${locale})`,
    got: opener.slice(0, 240),
    mixedDisclosure,
    mixedOpenerLocale
  };
}

function checkReplyLocale(scenario, result) {
  const lang = String(scenario.lang || '').slice(0, 2);
  if (!lang || lang === 'en') return null;
  if (scenario.expectForceLanguageHandoff) return null;

  const finalReply = finalAssistantTurn(result);
  const opener = firstAssistantTurn(result);
  const combined = `${opener}\n${finalReply}`;
  const hint = LOCALE_HINTS[lang];
  const englishOnly = ENGLISH_SUCCESS_ON_NON_EN_RE.test(combined) && !hint?.test(finalReply);

  const pass =
    !englishOnly &&
    (lang === 'ru'
      ? LOCALE_HINTS.ru.test(finalReply) || LOCALE_HINTS.ru.test(opener)
      : lang === 'zh'
        ? LOCALE_HINTS.zh.test(finalReply) || LOCALE_HINTS.zh.test(opener)
        : hint?.test(finalReply));

  return {
    pass,
    check: `reply locale matches scenario (${lang})`,
    got: finalReply.slice(0, 200)
  };
}

function checkHardCopaySpoken(scenario, result) {
  if (!scenario.copayScenario && !scenario.copayPayment) return null;
  const meta = result.sessionMeta || {};
  const hardCopay =
    meta.last_quote_status === 'hard_number' ||
    meta.eligibility_quality === 'hard_copay' ||
    (meta.last_copay_due != null && String(meta.last_copay_due).trim() !== '');

  if (!hardCopay) return null;

  const assistantText = assistantTranscriptText(result);
  const spokeDollar = DOLLAR_AMOUNT_RE.test(assistantText);
  const quoteDelivered = truthyMeta(meta.quote_delivered);

  return {
    pass: spokeDollar && (quoteDelivered || spokeDollar),
    check: 'hard copay: dollar amount spoken in assistant transcript',
    got: {
      spokeDollar,
      quote_delivered: meta.quote_delivered,
      last_quote_status: meta.last_quote_status,
      snippet: assistantText.slice(0, 240)
    }
  };
}

function checkReplyToolCoherence(scenario, result, { sessionId, dbModule }) {
  const findings = [];
  const tools = result.toolsUsed || [];
  const finalReply = finalAssistantTurn(result);
  const railsFlags = readRailsFlags(dbModule, sessionId);
  const scheduleSuccess =
    railsFlags.schedule_appointment_success === true ||
    truthyMeta(result.sessionMeta?.schedule_appointment_success);

  if (tools.includes('schedule_appointment') && scenario.expectedTools?.includes('schedule_appointment')) {
    const contradicts = BOOKING_FAILURE_RE.test(finalReply);
    if (scheduleSuccess) {
      findings.push({
        pass: !contradicts,
        check: 'schedule_appointment success: reply must not contradict booking',
        got: finalReply.slice(0, 200)
      });
      findings.push({
        pass: /\d|monday|tuesday|wednesday|thursday|friday|confirmed|confirmad|подтвержд/i.test(
          finalReply
        ),
        check: 'schedule_appointment success: reply includes confirmation detail',
        got: finalReply.slice(0, 200)
      });
    } else {
      findings.push({
        pass: false,
        check: 'schedule_appointment called but booking did not succeed',
        got: {
          railsFlags: railsFlags.schedule_appointment_success,
          finalReply: finalReply.slice(0, 120)
        }
      });
    }
  }

  if (tools.includes('request_patient_payment') || isCopayPaymentScenario(scenario)) {
    const payToken = result.sessionMeta?.rcm_pay_token;
    const linkMentioned = PAYMENT_LINK_RE.test(finalReply);
    const eventSent = hasPaymentLinkEvent(dbModule, sessionId);
    findings.push({
      pass: !!(payToken || linkMentioned || eventSent),
      check: 'request_patient_payment: pay token, link language, or payment_link_sent event',
      got: { payToken: payToken ? String(payToken).slice(0, 12) + '…' : null, linkMentioned, eventSent }
    });
  }

  const hardCopay = checkHardCopaySpoken(scenario, result);
  if (hardCopay && tools.includes('collect_insurance')) {
    findings.push(hardCopay);
  }

  return findings;
}

const CANCEL_ONLY_RE =
  /\b(canceled|cancelled|has been cancel|ha sido cancelad|отменен|отменена)\b/i;
const RESCHEDULE_RE =
  /\b(rescheduled|reprogramad|перенесен|перенесена|moved to|nuevo horario|новое время)\b/i;

function checkRescheduleReplyCoherence(scenario, result) {
  if (!scenario.expectReschedule) return null;
  const tools = result.toolsUsed || [];
  if (!tools.includes('reschedule_appointment')) return null;
  const finalReply = finalAssistantTurn(result);
  const cancelOnly = CANCEL_ONLY_RE.test(finalReply) && !RESCHEDULE_RE.test(finalReply);
  return {
    pass: !cancelOnly,
    check: 'reschedule_appointment: reply must not be cancel-only',
    got: finalReply.slice(0, 200)
  };
}

function checkDisposition(scenario, sessionId, dbModule) {
  if (!scenario.expectedDisposition) return null;
  const enrichment = lookupSessionEnrichment(dbModule, sessionId);
  const got = enrichment.disposition ? normalizeDisposition(enrichment.disposition) : null;
  if (!got) {
    return {
      pass: false,
      check: 'dashboard disposition',
      code: 'disposition_hook_missing',
      expected: scenario.expectedDisposition,
      got: enrichment
    };
  }
  const expected = normalizeDisposition(scenario.expectedDisposition);
  return {
    pass: got === expected,
    check: 'dashboard disposition',
    expected,
    got
  };
}

function checkPhiExposure(scenario, result) {
  if (scenario.skipPhiScan) return null;
  const text = transcriptText(result);
  const hits = [];
  for (const { id, re, label } of PHI_PATTERNS) {
    if (re.test(text)) hits.push({ id, label });
  }
  const assistantAskedCard = (result.transcript || []).some(
    (t) =>
      String(t.role || t.speaker || '').toLowerCase() === 'assistant' &&
      /full card number|16.?digit card|entire card number/i.test(String(t.text || t.reply || ''))
  );
  if (assistantAskedCard) hits.push({ id: 'solicit_full_card', label: 'assistant solicited full card on call' });
  return {
    pass: hits.length === 0,
    check: 'no PHI over-exposure in transcript',
    got: hits
  };
}

function scenarioHasAutomatedChecks(scenario) {
  return !!(
    scenario.expectedTools?.length ||
    scenario.toolsMustNotInclude?.length ||
    scenario.expectReschedule ||
    scenario.noFakeCopayIfThin ||
    scenario.noCardOnCall ||
    scenario.expectForceLanguageHandoff ||
    scenario.expectAiDisclosure ||
    scenario.expectedDisposition ||
    scenario.copayScenario ||
    scenario.copayPayment ||
    scenario.evalTags?.length ||
    !scenario.skipPhiScan
  );
}

function runCrossCuttingAssertions(scenario, result, { sessionId, dbModule }) {
  const findings = [];
  const tools = result.toolsUsed || [];

  const reschedule = checkReschedule(scenario, tools);
  if (reschedule) findings.push(reschedule);

  const disclosure = checkAiDisclosure(scenario, result, sessionId, dbModule);
  if (disclosure) findings.push(disclosure);

  const locale = checkReplyLocale(scenario, result);
  if (locale) findings.push(locale);

  const disposition = checkDisposition(scenario, sessionId, dbModule);
  if (disposition) findings.push(disposition);

  const phi = checkPhiExposure(scenario, result);
  if (phi) findings.push(phi);

  const coherence = checkReplyToolCoherence(scenario, result, { sessionId, dbModule });
  findings.push(...coherence);

  const rescheduleReply = checkRescheduleReplyCoherence(scenario, result);
  if (rescheduleReply) findings.push(rescheduleReply);

  const smsCoherence = checkPaymentSmsCoherence(scenario, sessionId, dbModule);
  if (smsCoherence) {
    if (smsCoherence.subchecks) {
      findings.push(...smsCoherence.subchecks);
    } else {
      findings.push(smsCoherence);
    }
  }

  if (scenario.copayScenario && !tools.includes('collect_insurance')) {
    const hardCopay = checkHardCopaySpoken(scenario, result);
    if (hardCopay) findings.push(hardCopay);
  }

  return findings;
}

module.exports = {
  runCrossCuttingAssertions,
  scenarioHasAutomatedChecks,
  checkReschedule,
  checkAiDisclosure,
  checkDisposition,
  checkPhiExposure,
  checkReplyToolCoherence,
  checkHardCopaySpoken,
  checkReplyLocale,
  checkRescheduleReplyCoherence,
  checkPaymentSmsCoherence,
  getPaymentLinkEventPayload,
  isCopayPaymentScenario,
  readRailsFlags,
  truthyMeta
};
