'use strict';

const { KELLY_LANE } = require('../state-schema');
const { buildBoundedPromptContext } = require('../prompt-bounding-locale');

const FIRST_CONTACT_POLICY =
  '对话风格：先简短回应患者刚才说的话，再只问一件事。语气温暖、从容。' +
  '先问姓名：若尚不知患者姓名，先问姓名再问“有什么可以帮您”；得知后称呼其名。' +
  '语音：每轮只问一个问题（约20字）。';

const BASE =
  '你是 Kelly，诊所前台 AI 助手。用工具获取事实；不要编造预约、 copay 或付款链接。' +
  '回复简洁友好。' +
  FIRST_CONTACT_POLICY;

const LANE_HINTS = {
  [KELLY_LANE.BASIC_INTAKE]: (step) => {
    const stepHints = {
      identity: '只问全名。',
      contact: '只问最佳联系电话。',
      dob: '只问出生日期。',
      status: '只问新患者还是老患者。',
      reason: '只问来访原因（行政登记，非临床问诊）。'
    };
    return `前台登记（步骤：${step}）。${stepHints[step] || '逐项收集登记信息。'}每轮一个问题。`;
  },
  [KELLY_LANE.CLINICAL]: (step) =>
    `来访原因（步骤：${step}）。仅收集行政原因，不做 OPQRST 临床分诊。`,
  [KELLY_LANE.BOOKING]: (step) => `预约（步骤：${step}）。查找时段并预约。`,
  [KELLY_LANE.PAYMENT]: (step) => `付款（步骤：${step}）。患者要付 copay 时使用 request_patient_payment。`,
  [KELLY_LANE.POST_PAYMENT]: (step) => `付款后（步骤：${step}）。确认预约日期时间。`,
  [KELLY_LANE.RESCHEDULE]: (step) => `改期（步骤：${step}）。查找并改期或取消。`,
  [KELLY_LANE.ACCOUNT]: (step) => `账户（步骤：${step}）。账单、收据、保险问题。`,
  [KELLY_LANE.RECORDS]: (step) => `病历（步骤：${step}）。使用 query_patient_records。`,
  [KELLY_LANE.EDUCATION]: (step) => `咨询（步骤：${step}）。一般性问题。`,
  [KELLY_LANE.SUPPORT]: (step) => `支持（步骤：${step}）。账单 FAQ 或转接人工。`
};

function laneSystemPrompt(lane, step, state, providerCtx = {}) {
  const hintFn = LANE_HINTS[lane];
  const hint = hintFn ? hintFn(step) : '';
  const identityParts = [];
  const name = providerCtx.clinicName ? String(providerCtx.clinicName).trim() : null;
  const specialty = providerCtx.specialty ? String(providerCtx.specialty).trim() : null;
  if (name) identityParts.push(`你是 ${name} 的前台 AI 助手。`);
  if (specialty) identityParts.push(`这是一家${specialty}诊所。`);
  const overlay = providerCtx.profilePrompt
    ? String(providerCtx.profilePrompt).trim()
    : providerCtx.customPrompt
      ? String(providerCtx.customPrompt).trim()
      : null;
  if (overlay) identityParts.push(`诊所说明：${overlay}`);
  const identityBlock = identityParts.length ? identityParts.join(' ') + '\n\n' : '';
  const bounded = buildBoundedPromptContext({ ...state, locale: 'zh' });
  return `${identityBlock}${BASE}\n\n${hint}${bounded.promptSuffix}\n会话：${state.session_id || ''}`;
}

module.exports = { laneSystemPrompt, BASE, LANE_HINTS, FIRST_CONTACT_POLICY };
