'use strict';

const SALES_STAGES = ['intro', 'qualify', 'demo_pitch', 'cta', 'close'];

function stageReply(stage, ctx) {
  const name = ctx.leadName || ctx.patientName || 'there';
  switch (stage) {
    case 'intro':
      return `Hi ${name}, this is Kelly from Somo. Is now still a good time to talk about how we help clinics?`;
    case 'qualify':
      return 'Great. Are you currently handling patient calls and scheduling in-house, or using another vendor?';
    case 'demo_pitch':
      return 'Somo provides an AI front desk that handles scheduling, intake, and billing follow-ups — all on your existing phone line.';
    case 'cta':
      return 'Would you like to schedule a quick demo with our team this week?';
    case 'close':
      return 'Thanks for your time. I will send a follow-up email with next steps.';
    default:
      return 'Thanks for speaking with Somo today.';
  }
}

async function handleOutboundSalesTurn(ctx = {}) {
  const step = ctx.sales_stage || ctx.active_subrail_step || 'intro';
  const idx = SALES_STAGES.indexOf(step);
  const nextStage = SALES_STAGES[Math.min(idx + 1, SALES_STAGES.length - 1)];
  const msg = String(ctx.message || '').toLowerCase();

  let reply = stageReply(step, ctx);
  let endCall = false;

  if (/not interested|no thanks|stop calling|remove me/.test(msg)) {
    reply = 'Understood. I will note that and we will not follow up further. Have a good day.';
    endCall = true;
  } else if (/yes|sure|demo|interested/.test(msg) && step === 'cta') {
    reply = 'Perfect. I will have someone from our team reach out to schedule your demo. Talk soon!';
    endCall = true;
  }

  return {
    reply,
    endCall,
    toolsUsed: [],
    conversation_mode: 'outbound_sales',
    sales_stage: nextStage,
    active_subrail_step: nextStage
  };
}

module.exports = { handleOutboundSalesTurn, SALES_STAGES, stageReply };
