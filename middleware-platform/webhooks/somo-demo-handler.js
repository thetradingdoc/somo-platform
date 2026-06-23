'use strict';

const db = require('../database');
const { isDemoEnabled } = require('../services/platform/somo-demo-service');
const { resolveTemplate } = require('../services/shared/somo-demo-template-registry');
const { USE_CASES } = require('../services/shared/somo-demo-use-cases');
const orchestrator = require('../services/shared/somo-demo-orchestrator');
const somoDemoSms = require('../services/voice/somo-demo-sms');
const somoDemoEmail = require('../services/shared/somo-demo-email');
const sheetsSync = require('../services/shared/somo-demo-sheets-sync');
const { evaluateFirstTurnLanguage } = require('../services/kelly/rails/language');
const {
  emergencyReply,
  getEmergencyResponseIfNeeded: getEmergencyResponseCore
} = require('../services/shared/emergency-safety');
const { primaryIntent } = require('../services/conversation/intent-detector');
const { UserIntent } = require('../services/conversation/conversation-mode-types');
const twilio = require('twilio');
const { getMaxDurationSec } = require('../lib/somo-demo-env');

function getCallType(connection) {
  const meta = connection.callMetadata || {};
  const dv =
    meta.dynamic_variables ||
    meta.retell_llm_dynamic_variables ||
    (meta.metadata && meta.metadata.dynamic_variables) ||
    {};
  return (
    meta.metadata?.call_type ||
    dv.call_type ||
    connection._demoCallType ||
    null
  );
}

function isSomoDemoDemoConnection(connection) {
  if (!isDemoEnabled()) return false;
  if (connection._isSomoDemoDemo === true) return true;
  if (connection._isSomoDemoDemo === false) return false;
  const callType = getCallType(connection);
  if (callType === 'somo_demo') {
    connection._isSomoDemoDemo = true;
    return true;
  }
  const meta = connection.callMetadata || {};
  const toNumber = meta.to_number || meta.metadata?.to_number || connection.to_number || null;
  const direction =
    meta.metadata?.direction ||
    meta.dynamic_variables?.direction ||
    connection.direction ||
    'inbound';
  if (toNumber && String(direction).toLowerCase() !== 'outbound') {
    try {
      const { isDemoLineToNumber } = require('../services/voice/voice-routing-world');
      if (isDemoLineToNumber(toNumber)) {
        connection._isSomoDemoDemo = true;
        connection._demoCallType = 'somo_demo';
        return true;
      }
    } catch (_) {}
  }
  connection._isSomoDemoDemo = false;
  return false;
}

function mergeQuestionsAsked(existing, addition) {
  const a = String(addition || '').trim();
  if (!a) return existing || null;
  const e = String(existing || '').trim();
  if (!e) return a;
  if (e.includes(a)) return e;
  return `${e}\n${a}`;
}

function hydrateContextFromDb(ctx, row) {
  if (!row) return ctx;
  return {
    ...ctx,
    prospect_name: ctx.prospect_name || row.name,
    prospect_email: ctx.prospect_email || row.email,
    use_case: ctx.use_case || row.use_case,
    language: ctx.language || row.language,
    detected_language: ctx.detected_language || row.language,
    practice_specialty: ctx.practice_specialty || row.practice_specialty,
    practice_size: ctx.practice_size || row.practice_size,
    questions_asked: ctx.questions_asked || row.questions_asked,
    country: ctx.country || row.country,
    city: ctx.city || row.city
  };
}

function extractDemoContext(connection) {
  const meta = connection.callMetadata || {};
  const dv =
    meta.dynamic_variables ||
    meta.retell_llm_dynamic_variables ||
    (meta.metadata && meta.metadata.dynamic_variables) ||
    {};

  let template;
  try {
    template = resolveTemplate({ use_case: dv.use_case || 'medical_clinic' });
  } catch {
    template = {
      personaName: 'Kelly',
      maxDurationSec: getMaxDurationSec(180),
      use_case_label: dv.use_case_label || 'Medical Clinic'
    };
  }

  let ctx = {
    demo_request_id: dv.demo_request_id || meta.metadata?.demo_request_id || null,
    prospect_name: dv.prospect_name || connection.customerName || 'there',
    use_case: dv.use_case || 'medical_clinic',
    use_case_label: dv.use_case_label || template.use_case_label,
    persona_name: template.personaName || 'Kelly',
    company_name: dv.company_name || 'Somo',
    maxDurationSec: template.maxDurationSec || 180,
    prospect_phone: connection.customerPhone,
    detected_language: connection._demoDetectedLanguage || dv.language || null,
    language: connection._demoDetectedLanguage || dv.language || null,
    practice_specialty: dv.practice_specialty || null,
    practice_size: dv.practice_size || null,
    questions_asked: dv.questions_asked || null
  };

  if (connection._demoDbRow) {
    ctx = hydrateContextFromDb(ctx, connection._demoDbRow);
  } else if (ctx.demo_request_id) {
    const row = db.getSomoDemoRequest(ctx.demo_request_id);
    if (row) {
      connection._demoDbRow = row;
      ctx = hydrateContextFromDb(ctx, row);
    }
  }

  return ctx;
}

function getDbRowForSheets(demoId, connection) {
  if (connection._demoDbRow && connection._demoDbRow.id === demoId) {
    return connection._demoDbRow;
  }
  const row = demoId ? db.getSomoDemoRequest(demoId) : null;
  if (row) connection._demoDbRow = row;
  return row;
}

function languageHandoffReply(language) {
  if (language === 'es') {
    return (
      'Quiero asegurarme de que nos entendamos bien — te conectaré con alguien del equipo que pueda ayudarte mejor.'
    );
  }
  return (
    'I want to make sure we communicate clearly — let me connect you with someone from our team who can help better.'
  );
}

function getEmergencyResponseIfNeeded(userSaid, language) {
  const base = getEmergencyResponseCore(userSaid, language);
  if (!base) return null;
  return {
    ...base,
    toolCalls: [{ name: 'end_call', arguments: {} }]
  };
}

async function handleFirstTurnLanguage(userSaid, ctx, connection) {
  if (connection._demoLanguageEvaluated) return ctx;
  connection._demoLanguageEvaluated = true;

  const langResult = evaluateFirstTurnLanguage(userSaid);
  const code = langResult.language || 'en';
  connection._demoDetectedLanguage = code;

  const next = {
    ...ctx,
    detected_language: code,
    language: code
  };

  if (ctx.demo_request_id) {
    db.updateSomoDemoRequest(ctx.demo_request_id, { language: code });
    const row = getDbRowForSheets(ctx.demo_request_id, connection);
    if (row) row.language = code;
  }

  if (langResult.forceLanguageHandoff) {
    return {
      ...next,
      _languageHandoff: true,
      _languageHandoffReply: languageHandoffReply(code)
    };
  }

  return next;
}

async function logCallEnded(ctx, connection, outcome) {
  const demoId = ctx.demo_request_id;
  if (!demoId) return;
  const row = getDbRowForSheets(demoId, connection);
  const endAt = new Date().toISOString();
  db.updateSomoDemoRequest(demoId, { outcome: outcome || 'completed_agent' });
  try {
    await sheetsSync.appendEventLog({
      event_type: 'call_ended',
      demo_request_id: demoId,
      phone: ctx.prospect_phone || row?.phone,
      status: outcome || 'completed',
      language: ctx.detected_language || row?.language,
      country: row?.country,
      city: row?.city,
      practice_specialty: row?.practice_specialty,
      practice_size: row?.practice_size,
      questions_asked: row?.questions_asked,
      metadata_json: { outcome: outcome || 'completed_agent', call_end_at: endAt }
    });
    await sheetsSync.upsertLeadStatus({
      demo_request_id: demoId,
      phone: row?.phone || ctx.prospect_phone,
      name: row?.name,
      language: ctx.detected_language || row?.language,
      country: row?.country,
      city: row?.city,
      practice_specialty: row?.practice_specialty,
      practice_size: row?.practice_size,
      questions_asked: row?.questions_asked,
      status: outcome || 'completed',
      call_end_at: endAt
    });
  } catch (e) {
    console.warn('Somo demo Sheets call_ended failed:', e.message);
  }
  try {
    const email = row?.email;
    if (email && !row?.signup_link_sent) {
      await somoDemoEmail.sendSignupEmail(email, { prospectName: row?.name || ctx.prospect_name });
      db.updateSomoDemoRequest(demoId, { signup_link_sent: 1, cta_offered_at: endAt });
    }
    const { upsertLeadFromDemoRequest } = require('../services/platform/somo-demo-service');
    upsertLeadFromDemoRequest({
      demoRequestId: demoId,
      name: row?.name || ctx.prospect_name,
      phone: row?.phone || ctx.prospect_phone,
      email: row?.email || null,
      useCase: row?.use_case,
      practiceSpecialty: row?.practice_specialty,
      questionsAsked: row?.questions_asked
    });
  } catch (e) {
    console.warn('Somo demo post-call email/lead sync failed:', e.message);
  }
}

function buildRecordInterestPatch(args, row) {
  const patch = {
    interest_level: args.level || 'warm',
    conversation_stage: 'QUALIFY'
  };
  if (args.language_detected) patch.language = args.language_detected;
  if (args.practice_specialty) patch.practice_specialty = args.practice_specialty;
  if (args.practice_size) patch.practice_size = args.practice_size;

  const practiceType = String(args.practice_type || '').trim().toLowerCase();
  if (practiceType && USE_CASES.has(practiceType)) {
    patch.use_case = practiceType;
  }

  const merged = mergeQuestionsAsked(
    row?.questions_asked,
    [args.primary_problem, args.notes].filter(Boolean).join(' — ')
  );
  if (merged) patch.questions_asked = merged;

  return patch;
}

function sendRetellResponse(ws, content, responseId) {
  if (!content) return;
  const safeResponseId = responseId === undefined || responseId === null ? 0 : responseId;
  ws.send(
    JSON.stringify({
      response_type: 'response',
      response_id: safeResponseId,
      content,
      content_complete: true
    })
  );
}

function sendFunctionCallResponse(ws, functionCallId, result) {
  ws.send(
    JSON.stringify({
      type: 'function_call_response',
      function_call_id: functionCallId,
      result
    })
  );
}

function sendDemoInitialGreeting(callId, connection, callMeta, responseId, sendFn) {
  if (!connection || connection.sentInitialGreeting) return;
  const ctx = extractDemoContext(connection);
  const first = (ctx.prospect_name || 'there').split(' ')[0];
  const opening = orchestrator.ruleBasedReply('OPEN', ctx);

  sendFn(connection.ws, opening, responseId);
  connection.sentInitialGreeting = true;
  connection._demoStage = orchestrator.initialStage();
  connection.conversationHistory.push({
    role: 'assistant',
    content: opening,
    timestamp: Date.now()
  });
  console.log(`👋 Somo demo qualification greeting for ${callId}`);
}

async function executeDemoTool(name, args, ctx, connection) {
  const demoId = ctx.demo_request_id;
  const row = demoId ? getDbRowForSheets(demoId, connection) : null;

  switch (name) {
    case 'record_interest': {
      const level = args.level || 'warm';
      const patch = buildRecordInterestPatch(args, row);
      patch.interest_level = level;
      if (demoId) {
        db.updateSomoDemoRequest(demoId, patch);
        if (row) {
          Object.assign(row, patch);
          connection._demoDbRow = row;
        }
      }
      try {
        await sheetsSync.appendEventLog({
          event_type: 'qualification_captured',
          demo_request_id: demoId,
          phone: ctx.prospect_phone || row?.phone,
          language: patch.language || ctx.detected_language || row?.language,
          country: row?.country,
          city: row?.city,
          practice_specialty: patch.practice_specialty || row?.practice_specialty,
          practice_size: patch.practice_size || row?.practice_size,
          questions_asked: patch.questions_asked || row?.questions_asked,
          metadata_json: {
            interest_level: level,
            practice_type: args.practice_type,
            primary_problem: args.primary_problem,
            notes: args.notes
          }
        });
        await sheetsSync.upsertLeadStatus({
          demo_request_id: demoId,
          phone: row?.phone || ctx.prospect_phone,
          name: row?.name,
          language: patch.language || row?.language,
          country: row?.country,
          city: row?.city,
          practice_specialty: patch.practice_specialty || row?.practice_specialty,
          practice_size: patch.practice_size || row?.practice_size,
          questions_asked: patch.questions_asked || row?.questions_asked,
          status: 'qualified'
        });
      } catch (e) {
        console.warn('Somo demo Sheets qualification_captured failed:', e.message);
      }
      try {
        const { upsertLeadFromDemoRequest } = require('../services/platform/somo-demo-service');
        upsertLeadFromDemoRequest({
          demoRequestId: demoId,
          name: row?.name || ctx.prospect_name,
          phone: row?.phone || ctx.prospect_phone,
          email: row?.email || ctx.prospect_email,
          useCase: patch.use_case || row?.use_case,
          practiceSpecialty: patch.practice_specialty || row?.practice_specialty,
          questionsAsked: patch.questions_asked || row?.questions_asked,
          qualification: {
            interest_level: level,
            practice_type: args.practice_type,
            primary_problem: args.primary_problem,
            practice_size: args.practice_size,
            notes: args.notes
          }
        });
      } catch (e) {
        console.warn('Somo demo lead qualification sync failed:', e.message);
      }
      return { success: true, recorded: level };
    }
    case 'send_signup_link': {
      const phone = connection.customerPhone;
      const prospectEmail = row?.email || ctx.prospect_email || null;
      if (prospectEmail) {
        const mail = await somoDemoEmail.sendSignupEmail(prospectEmail, { prospectName: ctx.prospect_name });
        if (demoId) {
          db.updateSomoDemoRequest(demoId, {
            signup_link_sent: 1,
            cta_offered_at: new Date().toISOString(),
            conversation_stage: 'CTA'
          });
        }
        return { success: true, channel: 'email', ...mail };
      }
      if (!phone) return { success: false, error: 'No phone on call' };
      const sms = await somoDemoSms.sendSignupLink(phone, { prospectName: ctx.prospect_name });
      if (demoId) {
        db.updateSomoDemoRequest(demoId, {
          signup_link_sent: 1,
          cta_offered_at: new Date().toISOString(),
          conversation_stage: 'CTA'
        });
      }
      try {
        await sheetsSync.appendEventLog({
          event_type: 'cta_sent',
          demo_request_id: demoId,
          phone: ctx.prospect_phone || row?.phone,
          status: 'cta_sent',
          language: ctx.detected_language || row?.language
        });
        await sheetsSync.upsertLeadStatus({
          demo_request_id: demoId,
          phone: row?.phone || ctx.prospect_phone,
          name: row?.name,
          language: ctx.detected_language || row?.language,
          country: row?.country,
          city: row?.city,
          practice_specialty: row?.practice_specialty,
          practice_size: row?.practice_size,
          questions_asked: row?.questions_asked,
          status: 'cta_sent'
        });
      } catch (e) {
        console.warn('Somo demo Sheets cta_sent failed:', e.message);
      }
      return { success: true, ...sms };
    }
    case 'send_signup_email': {
      const prospectEmail = row?.email || ctx.prospect_email || null;
      if (!prospectEmail) return { success: false, error: 'No email on file' };
      const mail = await somoDemoEmail.sendSignupEmail(prospectEmail, { prospectName: ctx.prospect_name });
      if (demoId) {
        db.updateSomoDemoRequest(demoId, {
          signup_link_sent: 1,
          cta_offered_at: new Date().toISOString(),
          conversation_stage: 'CTA'
        });
      }
      try {
        await sheetsSync.appendEventLog({
          event_type: 'cta_email_sent',
          demo_request_id: demoId,
          phone: row?.phone || ctx.prospect_phone,
          status: 'cta_sent',
          language: ctx.detected_language || row?.language
        });
      } catch (e) {
        console.warn('Somo demo Sheets cta_email_sent failed:', e.message);
      }
      return { success: true, channel: 'email', ...mail };
    }
    case 'end_call': {
      await hangupTwilioCall(connection);
      if (demoId) {
        db.updateSomoDemoRequest(demoId, {
          outcome: 'completed_agent',
          conversation_stage: 'CLOSE'
        });
      }
      await logCallEnded(ctx, connection, 'completed_agent');
      return { success: true, ended: true };
    }
    default:
      return { success: false, error: `Unknown demo tool: ${name}` };
  }
}

function capturePartialDemoSession(connection, reason) {
  const ctx = extractDemoContext(connection);
  const demoId = ctx.demo_request_id;
  if (!demoId) return;
  const lastUser = [...(connection.conversationHistory || [])]
    .reverse()
    .find((m) => m.role === 'user');
  try {
    db.updateSomoDemoRequest(demoId, {
      conversation_stage: connection._demoStage || 'OPEN',
      questions_asked: mergeQuestionsAsked(
        connection._demoDbRow?.questions_asked,
        `partial:${reason}:${(lastUser?.content || '').slice(0, 120)}`
      ),
      outcome: 'partial_capture'
    });
  } catch (_) {}
}

function trimDemoReply(text, maxWords = 25) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}

function isDemoOffScriptHandoff(msg) {
  const pi = primaryIntent(msg);
  return pi.intent === UserIntent.HANDOFF;
}

async function handleDemoOffScriptHandoff(callId, connection, userSaid, message, sendFn, ctx) {
  const es = (ctx.detected_language || ctx.language || 'en') === 'es';
  const reply = es
    ? 'Gracias por tu interés. Nuestro equipo te contactará pronto. ¡Que tengas buen día!'
    : 'Thanks for your interest. Someone from our team will reach out shortly. Have a great day!';
  await executeDemoTool(
    'record_interest',
    { level: 'warm', primary_problem: 'off_script_handoff', notes: String(userSaid || '').slice(0, 200) },
    ctx,
    connection
  );
  sendFn(connection.ws, trimDemoReply(reply), message.response_id);
  connection.conversationHistory.push({ role: 'assistant', content: reply, timestamp: Date.now() });
  connection._demoStage = 'CLOSE';
  await executeDemoTool('end_call', {}, ctx, connection);
  await hangupTwilioCall(connection);
}

async function hangupTwilioCall(connection) {
  const sid =
    connection.twilio_call_sid ||
    connection.callMetadata?.metadata?.twilio_call_sid;
  if (!sid) return;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return;
  try {
    const client = twilio(accountSid, authToken);
    await client.calls(sid).update({ status: 'completed' });
  } catch (e) {
    console.warn('Somo demo demo hangup failed:', e.message);
  }
}

async function handleDemoTranscript(callId, connection, userSaid, message, sendFn) {
  let ctx = extractDemoContext(connection);
  const langCode = ctx.detected_language || ctx.language || 'en';

  if (!connection._demoLanguageEvaluated && userSaid) {
    ctx = await handleFirstTurnLanguage(userSaid, ctx, connection);
    if (ctx._languageHandoff) {
      const reply = ctx._languageHandoffReply;
      sendFn(connection.ws, reply, message.response_id);
      connection.conversationHistory.push({
        role: 'assistant',
        content: reply,
        timestamp: Date.now()
      });
      await executeDemoTool('end_call', {}, ctx, connection);
      return;
    }
  }

  const emergency = getEmergencyResponseIfNeeded(userSaid, langCode);
  if (emergency) {
    sendFn(connection.ws, emergency.reply, message.response_id);
    connection.conversationHistory.push({
      role: 'assistant',
      content: emergency.reply,
      timestamp: Date.now()
    });
    connection._demoStage = 'CLOSE';
    for (const tool of emergency.toolCalls) {
      await executeDemoTool(tool.name, tool.arguments || {}, ctx, connection);
    }
    await hangupTwilioCall(connection);
    return;
  }

  if (isDemoOffScriptHandoff(userSaid)) {
    await handleDemoOffScriptHandoff(callId, connection, userSaid, message, sendFn, ctx);
    return;
  }

  const elapsedSec = Math.floor((Date.now() - (connection.startTime || Date.now())) / 1000);

  const result = await orchestrator.processTurn({
    userMessage: userSaid,
    stage: connection._demoStage || orchestrator.initialStage(),
    context: ctx,
    conversationHistory: connection.conversationHistory,
    elapsedSec,
    maxDurationSec: ctx.maxDurationSec
  });

  connection._demoStage = result.stage;
  if (ctx.demo_request_id) {
    const interest = result.toolCalls?.find((t) => t.name === 'record_interest')?.arguments?.level;
    if (interest) {
      db.updateSomoDemoRequest(ctx.demo_request_id, {
        conversation_stage: result.stage,
        interest_level: interest
      });
    } else {
      db.updateSomoDemoRequest(ctx.demo_request_id, { conversation_stage: result.stage });
    }
  }

  for (const tool of result.toolCalls || []) {
    await executeDemoTool(tool.name, tool.arguments || {}, ctx, connection);
  }

  let reply = result.reply;
  if (reply) reply = trimDemoReply(reply);
  if (!reply && result.endCall) {
    reply = orchestrator.ruleBasedReply('CLOSE', ctx);
  }
  if (reply) {
    sendFn(connection.ws, reply, message.response_id);
    connection.conversationHistory.push({
      role: 'assistant',
      content: reply,
      timestamp: Date.now()
    });
  }

  if (result.endCall) {
    await hangupTwilioCall(connection);
    if (!result.toolCalls?.some((t) => t.name === 'end_call')) {
      await logCallEnded(ctx, connection, 'completed_agent');
    }
  }
}

async function handleDemoFunctionCall(callId, connection, message) {
  const functionCall = message.function_call || message;
  const name = functionCall.name;
  const args = functionCall.parameters || functionCall.arguments || {};
  const ctx = extractDemoContext(connection);
  const result = await executeDemoTool(name, args, ctx, connection);
  sendFunctionCallResponse(
    connection.ws,
    functionCall.id || functionCall.function_call_id,
    result
  );
}

async function handleDemoMessage(callId, connection, message, handlers) {
  const { sendRetellResponse: sendFn, interactionType } = handlers;
  const callMeta = message.call || connection.callMetadata;

  if (callMeta) {
    connection.callMetadata = callMeta;
    if (callMeta.from_number) {
      const SMSService = require('../services/platform/sms-service');
      connection.customerPhone = SMSService.formatPhoneNumber(callMeta.from_number);
    }
    const dv =
      callMeta.dynamic_variables ||
      callMeta.retell_llm_dynamic_variables ||
      {};
    const prospect = dv.prospect_name || dv.patient_name;
    if (prospect && String(prospect).trim()) {
      connection.customerName = String(prospect).trim();
      connection.awaitingName = false;
    }
    if (callMeta.metadata?.twilio_call_sid) {
      connection.twilio_call_sid = callMeta.metadata.twilio_call_sid;
    }
    const demoId = dv.demo_request_id || callMeta.metadata?.demo_request_id;
    if (demoId && !connection._demoDbRow) {
      connection._demoDbRow = db.getSomoDemoRequest(demoId);
    }
  }

  if (!connection.sentInitialGreeting && (interactionType === 'response_required' || callMeta)) {
    sendDemoInitialGreeting(callId, connection, callMeta, message.response_id, sendFn);
    if (interactionType === 'response_required' && !message.transcript) {
      return true;
    }
  }

  if (interactionType === 'function_call') {
    await handleDemoFunctionCall(callId, connection, message);
    return true;
  }

  if (interactionType === 'response_required' || interactionType === 'reminder_required') {
    let userSaid = null;
    if (Array.isArray(message.transcript)) {
      const last = [...message.transcript].reverse().find((t) => t?.role === 'user' && t?.content);
      userSaid = last?.content;
    }
    if (userSaid) {
      connection.conversationHistory.push({
        role: 'user',
        content: userSaid,
        timestamp: Date.now()
      });
      await handleDemoTranscript(callId, connection, userSaid, message, sendFn);
    }
    return true;
  }

  return false;
}

module.exports = {
  isSomoDemoDemoConnection,
  sendDemoInitialGreeting,
  handleDemoMessage,
  handleDemoTranscript,
  handleDemoFunctionCall,
  extractDemoContext,
  getCallType,
  getEmergencyResponseIfNeeded,
  buildRecordInterestPatch,
  capturePartialDemoSession,
  trimDemoReply,
  emergencyReply
};
