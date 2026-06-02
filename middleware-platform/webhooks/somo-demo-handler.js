'use strict';

const db = require('../database');
const { isDemoEnabled } = require('../services/somo-demo-service');
const { resolveTemplate } = require('../services/somo-demo-template-registry');
const orchestrator = require('../services/somo-demo-orchestrator');
const somoDemoSms = require('../services/somo-demo-sms');
const twilio = require('twilio');

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
  const isDemo = callType === 'somo_demo';
  connection._isSomoDemoDemo = isDemo;
  return isDemo;
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
    template = resolveTemplate({ use_case: dv.use_case || 'receptionist' });
  } catch {
    template = {
      personaName: 'Sam',
      maxDurationSec: parseInt(process.env.DODGECALL_DEMO_MAX_DURATION_SEC, 10) || 240,
      use_case_label: dv.use_case_label || 'Receptionist'
    };
  }

  return {
    demo_request_id: dv.demo_request_id || meta.metadata?.demo_request_id || null,
    prospect_name: dv.prospect_name || connection.customerName || 'there',
    use_case: dv.use_case || 'receptionist',
    use_case_label: dv.use_case_label || template.use_case_label,
    persona_name: template.personaName || 'Sam',
    company_name: dv.company_name || 'Somo demo',
    maxDurationSec: template.maxDurationSec || 240,
    prospect_phone: connection.customerPhone
  };
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
  const opening = `Hi ${first}, this is ${ctx.persona_name} from Somo demo. You asked for a quick live demo — is now still a good time?`;

  sendFn(connection.ws, opening, responseId);
  connection.sentInitialGreeting = true;
  connection._demoStage = orchestrator.initialStage();
  connection.conversationHistory.push({
    role: 'assistant',
    content: opening,
    timestamp: Date.now()
  });
  console.log(`👋 Somo demo demo greeting for ${callId}`);
}

async function executeDemoTool(name, args, ctx, connection) {
  const demoId = ctx.demo_request_id;
  switch (name) {
    case 'record_interest': {
      const level = args.level || 'warm';
      if (demoId) {
        db.updateSomoDemoRequest(demoId, {
          interest_level: level,
          conversation_stage: connection._demoStage
        });
      }
      return { success: true, recorded: level };
    }
    case 'send_signup_link': {
      const phone = connection.customerPhone;
      if (!phone) return { success: false, error: 'No phone on call' };
      const sms = await somoDemoSms.sendSignupLink(phone, { prospectName: ctx.prospect_name });
      if (demoId) {
        db.updateSomoDemoRequest(demoId, {
          signup_link_sent: 1,
          cta_offered_at: new Date().toISOString(),
          conversation_stage: 'CTA'
        });
      }
      return { success: true, ...sms };
    }
    case 'end_call': {
      await hangupTwilioCall(connection);
      if (demoId) {
        db.updateSomoDemoRequest(demoId, {
          outcome: 'completed_agent',
          conversation_stage: 'CLOSE'
        });
      }
      return { success: true, ended: true };
    }
    default:
      return { success: false, error: `Unknown demo tool: ${name}` };
  }
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
  const ctx = extractDemoContext(connection);
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
    db.updateSomoDemoRequest(ctx.demo_request_id, {
      conversation_stage: result.stage,
      interest_level: result.toolCalls?.find((t) => t.name === 'record_interest')?.arguments?.level
    });
  }

  for (const tool of result.toolCalls || []) {
    await executeDemoTool(tool.name, tool.arguments || {}, ctx, connection);
  }

  let reply = result.reply;
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
      const SMSService = require('../services/sms-service');
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
  getCallType
};
