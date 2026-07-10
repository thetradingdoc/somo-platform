'use strict';

const { upsertPlatformQualLead, ensureLeadCallRow } = require('../../sales-crm-tools');

const SALES_STAGES = [
  'greeting',
  'practice_type',
  'pain',
  'value_demo',
  'signup_cta',
  'demo_offer',
  'close'
];

const FORBIDDEN_PERSONA_RE =
  /front desk receptionist|virtual assistant|alex from somo|can i start with your name|may i please start with your name/i;

function buildPlatformSalesOpener() {
  return (
    'Thanks for calling Somo. This call may be recorded for quality and training. ' +
    "Hi, I'm Kelly with Somo — I help dental and medical practices see how our AI front desk can handle scheduling and patient calls. " +
    'What kind of practice are you calling from today?'
  );
}

function isHandoffRequest(msg) {
  return /\b(human|person|representative|someone|transfer|callback|call me back|real person|operator)\b/i.test(
    String(msg || '')
  );
}

function isSignupIntent(msg) {
  return /\b(sign up|signup|demo|try somo|learn more|pricing|get started|interested)\b/i.test(String(msg || ''));
}

function isTenantIssue(msg) {
  return /\b(account|billing|login|password|my practice|tenant|dashboard|not working|broken)\b/i.test(
    String(msg || '')
  );
}

function inferPracticeType(msg) {
  const lower = String(msg || '').toLowerCase();
  if (/dental|dentist|ortho|hygien/.test(lower)) return 'dental';
  if (/medical|derm|pediatric|clinic|primary care|specialist/.test(lower)) return 'medical';
  if (msg && msg.trim().length > 2) return 'other';
  return null;
}

function stageReply(stage, ctx = {}) {
  const name = ctx.tenant_name || ctx.clinic_name || '';
  switch (stage) {
    case 'greeting':
      return buildPlatformSalesOpener();
    case 'practice_type':
      if (ctx.caller_type === 'sales_lead' && ctx.clinic_name) {
        return `Welcome back${name ? ` from ${name}` : ''}. What type of practice do you run — dental, medical, or something else?`;
      }
      return 'Great — are you a dental practice, medical practice, or something else?';
    case 'pain':
      return 'What is the biggest challenge today — missed calls, scheduling, after-hours coverage, or something else?';
    case 'value_demo':
      return (
        'Here is what Kelly does for a practice like yours: she answers your line 24/7, books appointments into your schedule, ' +
        'and handles common patient questions — so your team can focus on in-office care. Does that sound useful?'
      );
    case 'signup_cta':
      return 'You can start a free trial anytime at callsomo.com/signup. Would you like me to note your email so our team can follow up?';
    case 'demo_offer':
      return 'Would you like to schedule a fuller walkthrough with our team this week?';
    case 'tenant_help':
      return `Hi${name ? ` ${name}` : ''} — I see you are a Somo customer. Are you calling about your account or billing?`;
    case 'handoff_offer':
      return 'I will connect you with someone on our team. Please hold while I transfer your call.';
    case 'close':
      return 'Thanks for calling Somo. You can also sign up anytime at callsomo.com. Have a great day.';
    default:
      return buildPlatformSalesOpener();
  }
}

function resolveCallerType(ctx, msg) {
  let callerType = ctx.caller_type || ctx.platform_caller_type || 'unknown';
  if (callerType === 'unknown') {
    if (isTenantIssue(msg)) callerType = 'tenant';
    else if (isSignupIntent(msg)) callerType = 'sales_lead';
  }
  return callerType;
}

function maybeEnsureLead(ctx) {
  const db = ctx.db;
  const phone = ctx.callerPhone || ctx.caller_phone || null;
  if (!db || !phone) return ctx.lead_id || ctx.platform_lead_id || null;

  const lead = upsertPlatformQualLead(db, {
    phone,
    callerPhone: phone,
    fields: {
      clinic_name: ctx.clinic_name || undefined,
      notes: ctx.platform_qual_notes || undefined
    }
  });
  const leadId = lead?.id || ctx.lead_id || ctx.platform_lead_id || null;
  if (leadId && ctx.sessionId) {
    ensureLeadCallRow(db, { leadId, callId: ctx.callId || ctx.sessionId, direction: 'inbound' });
  }
  return leadId;
}

async function handleSomoSalesInboundTurn(ctx = {}) {
  const msg = String(ctx.message || '').trim();
  const lower = msg.toLowerCase();

  if (isHandoffRequest(msg)) {
    return {
      reply: stageReply('handoff_offer', ctx),
      endCall: false,
      conversation_mode: 'platform_support',
      platform_stage: 'handoff_offer',
      active_subrail: 'handoff',
      disposition: 'handoff_requested',
      flags: { pending_human_handoff: true },
      toolsUsed: [{ name: 'request_human_handoff', args: { reason: 'caller_requested' } }]
    };
  }

  const callerType = resolveCallerType(ctx, msg);
  if (callerType === 'tenant') {
    return {
      reply: stageReply('tenant_help', ctx),
      endCall: false,
      conversation_mode: 'platform_support',
      platform_stage: 'tenant_help',
      caller_type: 'tenant',
      state_updates: {
        platform_stage: 'tenant_help',
        platform_caller_type: 'tenant',
        active_subrail_step: 'tenant_help'
      },
      flags: { tenant_support: true }
    };
  }

  let step = ctx.platform_stage || ctx.active_subrail_step || 'greeting';
  if (ctx.opener_delivered && (step === 'greeting' || step === 'triage')) {
    step = 'practice_type';
  }

  const toolsUsed = [];
  let qualNotes = ctx.platform_qual_notes || '';
  let practiceType = ctx.platform_practice_type || null;

  if (step === 'practice_type' && msg.length > 2) {
    practiceType = inferPracticeType(msg) || practiceType;
    if (practiceType) qualNotes = qualNotes ? `${qualNotes}; practice=${practiceType}` : `practice=${practiceType}`;
  }
  if (step === 'pain' && msg.length > 4) {
    qualNotes = qualNotes ? `${qualNotes}; pain=${msg.slice(0, 200)}` : `pain=${msg.slice(0, 200)}`;
  }

  const leadId = maybeEnsureLead({ ...ctx, platform_qual_notes: qualNotes, caller_type: callerType });

  const idx = SALES_STAGES.indexOf(step);
  let nextStage = SALES_STAGES[Math.min(Math.max(idx, 0) + 1, SALES_STAGES.length - 1)];
  const userAdvanced =
    (step === 'practice_type' && msg.length > 2) ||
    (step === 'pain' && msg.length > 4) ||
    (step === 'value_demo' && msg.length > 2) ||
    (step === 'signup_cta' && msg.length > 2) ||
    (step === 'demo_offer' && msg.length > 2);
  let reply = stageReply(userAdvanced ? nextStage : step, { ...ctx, caller_type: callerType, clinic_name: ctx.clinic_name });
  let endCall = false;

  if (/\b(no|nothing|goodbye|bye|that's all|thank you)\b/i.test(lower) && idx >= 2) {
    reply = stageReply('close', ctx);
    endCall = true;
    nextStage = 'close';
  }

  if (step === 'signup_cta' && /\b(yes|sure|email|send|okay|ok)\b/i.test(lower)) {
    const emailMatch = msg.match(/[\w.+-]+@[\w.-]+\.\w+/);
    toolsUsed.push({
      name: 'collect_contact_info',
      args: {
        lead_id: leadId,
        contact_email: emailMatch ? emailMatch[0] : undefined,
        contact_phone: ctx.callerPhone || ctx.caller_phone,
        interest_level: 'high',
        notes: qualNotes || 'Signup interest on inbound platform call',
        clinic_name: ctx.clinic_name || 'Inbound platform caller'
      }
    });
    reply =
      'Perfect — I have noted your interest. You can also start at callsomo.com/signup anytime. Would you like a live walkthrough with our team?';
    nextStage = 'demo_offer';
  }

  if (step === 'demo_offer' && /\b(yes|sure|demo|schedule|this week|tomorrow)\b/i.test(lower)) {
    toolsUsed.push({
      name: 'schedule_demo',
      args: {
        lead_id: leadId,
        preferred_date: 'TBD',
        preferred_time: 'TBD',
        contact_name: ctx.clinic_name || 'Inbound caller',
        contact_email: ctx.contact_email,
        clinic_name: ctx.clinic_name || 'Inbound platform caller'
      }
    });
    reply = 'Great — I will have someone from our team reach out to schedule your demo. Thanks for calling Somo!';
    endCall = true;
    nextStage = 'close';
  }

  return {
    reply,
    endCall,
    conversation_mode: 'platform_support',
    platform_stage: nextStage,
    active_subrail_step: nextStage,
    caller_type: callerType,
    lead_id: leadId,
    disposition: endCall ? 'completed' : null,
    toolsUsed,
    state_updates: {
      platform_stage: nextStage,
      platform_caller_type: callerType,
      active_subrail_step: nextStage,
      platform_practice_type: practiceType,
      platform_qual_notes: qualNotes,
      lead_id: leadId
    },
    flags: {
      inbound_platform: true,
      qualification_captured: !!(practiceType || qualNotes)
    }
  };
}

module.exports = {
  handleSomoSalesInboundTurn,
  buildPlatformSalesOpener,
  SALES_STAGES,
  stageReply,
  FORBIDDEN_PERSONA_RE,
  isHandoffRequest
};
