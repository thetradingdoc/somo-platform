'use strict';

const MERCHANT_ID = 'merchant_c3d547a10f43eeec';
const CLINIC_ID = 'clinic-default';

function agent(text, opts = {}) {
  return {
    speaker: 'agent',
    text,
    ...opts
  };
}

function caller(text, opts = {}) {
  const asr = opts.asr || { noise: opts.noise || 'clean', confidence: opts.confidence ?? 0.92 };
  const { noise, confidence, ...rest } = opts;
  return {
    speaker: 'caller',
    text,
    asr,
    ...rest
  };
}

function seqTurns(turns) {
  return turns.map((t, i) => ({ seq: i + 1, ...t }));
}

function voiceMeta(overrides = {}) {
  return {
    direction: 'inbound',
    call_type: 'tenant',
    locale: 'en-US',
    caller_id: overrides.caller_id || '+15550100000',
    after_hours: false,
    duration_target_sec: 120,
    merchant_id: MERCHANT_ID,
    clinic_id: CLINIC_ID,
    ...overrides
  };
}

function chatMeta(overrides = {}) {
  return {
    direction: 'inbound',
    call_type: 'tenant',
    locale: 'en-US',
    caller_id: null,
    after_hours: false,
    duration_target_sec: 180,
    merchant_id: MERCHANT_ID,
    clinic_id: CLINIC_ID,
    ...overrides
  };
}

function outboundMeta(overrides = {}) {
  return voiceMeta({
    direction: 'outbound',
    call_type: 'operator_outbound',
    caller_id: '+15559876543',
    ...overrides
  });
}

function padTurnsToMin(turns, channel) {
  const min = channel === 'chat' ? 14 : 12;
  const out = [...turns];
  const lastBeforePad = out[out.length - 1];
  const insertAt = lastBeforePad?.tool_call?.name === 'end_call' ? out.length - 1 : out.length;

  const voiceFillers = [
    agent('Is there anything else I can help you with today?'),
    caller('No, I think that is everything. Thank you.'),
    agent('You are welcome. I am glad we could help.'),
    caller('Thanks again.'),
    agent('Of course — take care.')
  ];
  const chatFillers = [
    agent('Anything else you would like to know before we wrap up?'),
    caller('No, that is all for now.'),
    agent('Happy to help anytime.'),
    caller('Great, thanks.'),
    agent('You are all set on my end.')
  ];
  const fillers = channel === 'chat' ? chatFillers : voiceFillers;

  let fi = 0;
  while (out.length < min) {
    out.splice(insertAt + fi, 0, fillers[fi % fillers.length]);
    fi += 1;
  }

  const final = out[out.length - 1];
  if (final?.tool_call?.name !== 'end_call') {
    out.push(agent('Take care.', { tool_call: { name: 'end_call', args: { reason: 'caller_done' } } }));
  }
  return out;
}

function buildCall({ id, title, channel, call_metadata, preconditions, turns, functions_tested, assertions, failure_codes, min_turns }) {
  const padded = padTurnsToMin(turns, channel);
  const sequenced = seqTurns(padded);
  const minRequired = channel === 'chat' ? 14 : 12;
  if (sequenced.length < minRequired) {
    throw new Error(`${id}: only ${sequenced.length} turns, need ${minRequired}`);
  }
  return {
    id,
    title,
    channel,
    call_metadata,
    preconditions: preconditions || { session_seed: {}, products: [], appointments: [] },
    turns: sequenced,
    functions_tested,
    assertions: assertions || [],
    failure_codes: failure_codes || [],
    min_turns: min_turns || sequenced.length
  };
}

function greet() {
  return agent('Thank you for calling Somo Supplements. This is Kelly. How can I help you today?');
}

function chatGreet() {
  return agent("Hi there — I'm Kelly, your Somo checkout assistant. I can answer product questions and help you order safely. What can I help you with today?");
}

function closeThanks(name) {
  const n = name ? `, ${name}` : '';
  return [
    caller('No, that is all. Thank you.'),
    agent(`You are welcome${n}. Take care.`, {
      tool_call: { name: 'end_call', args: { reason: 'caller_done' } }
    })
  ];
}

module.exports = {
  MERCHANT_ID,
  CLINIC_ID,
  agent,
  caller,
  seqTurns,
  padTurnsToMin,
  voiceMeta,
  chatMeta,
  outboundMeta,
  buildCall,
  greet,
  chatGreet,
  closeThanks
};
