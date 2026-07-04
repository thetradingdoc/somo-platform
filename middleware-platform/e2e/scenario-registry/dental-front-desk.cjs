'use strict';

/**
 * SSOT for NYC dental front-desk eval scenarios (PSTN + multilang).
 * Consumers: dental-pstn-scenarios.cjs, kelly-multilang-conversation-eval.cjs, verify-pilot-scenario-matrix.cjs
 */

const crypto = require('crypto');

/** @typedef {object} DentalPstnScenario */
/** @typedef {object} MultilangScenario */

/** @type {DentalPstnScenario[]} */
const DENTAL_PSTN_SCENARIOS = [
  {
    id: 'DENTAL-001',
    title: 'New patient — cleaning (D1110)',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'booking',
    utterances: [
      "Hi, I'm a new patient and I need a cleaning.",
      'Yes, sometime next week in the morning works.'
    ],
    expectedTools: ['schedule_appointment'],
    assertions: ['FRONT_DESK_INTAKE', 'BOOKING_OFFER'],
    skipIdentityAdmission: true
  },
  {
    id: 'DENTAL-002',
    title: 'Returning patient — Delta Dental member ID',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'copay',
    utterances: [
      "I'm a returning patient. Do you take Delta Dental?",
      'My member ID is DD123456789.'
    ],
    expectedTools: ['collect_insurance'],
    assertions: ['PAYER_COLLECT', 'NO_PHI_LEAK'],
    skipIdentityAdmission: true
  },
  {
    id: 'DENTAL-003',
    title: 'Copay quote + SMS pay link',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'copay',
    utterances: ["What's my copay for a cleaning?", 'Yes, send me the payment link by text.'],
    expectedTools: ['collect_insurance', 'request_patient_payment'],
    assertions: ['COPAY_QUOTE', 'PAYMENT_LINK'],
    skipIdentityAdmission: false,
    checkSessionDeskParity: true,
    copayScenario: true,
    copayPayment: true,
    evalTags: ['copay_payment']
  },
  {
    id: 'DENTAL-004',
    title: 'Self-pay fallback — no insurance',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'copay',
    utterances: ["I don't have insurance. How much is a cleaning out of pocket?"],
    expectedTools: ['request_patient_payment'],
    assertions: ['SELF_PAY_RAIL'],
    skipIdentityAdmission: false
  },
  {
    id: 'DENTAL-005',
    title: 'Russian bilingual greeting',
    locale: 'ru-RU',
    language_mode: 'en_ru',
    intent: 'booking',
    utterances: ['Здравствуйте, мне нужна запись на чистку зубов.'],
    expectedTools: ['schedule_appointment'],
    assertions: ['BILINGUAL_GREETING'],
    skipIdentityAdmission: true
  },
  {
    id: 'DENTAL-006',
    title: 'After-hours — coverage mode',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'inquiry',
    after_hours: true,
    utterances: ['I know you are closed but can I leave a message for tomorrow?'],
    expectedTools: ['transfer_call'],
    assertions: ['AFTER_HOURS_HANDOFF'],
    skipIdentityAdmission: true
  },
  {
    id: 'DENTAL-007',
    title: 'Wrong office — polite boundary',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'inquiry',
    utterances: ['Is this Dr. Patel orthopedic office on Lexington?'],
    expectedTools: [],
    assertions: ['POLITE_BOUNDARY', 'NO_PHI_LEAK'],
    skipIdentityAdmission: true
  },
  {
    id: 'DENTAL-008',
    title: 'Family caller — booking for spouse',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'booking',
    family_caller: true,
    utterances: [
      "I'm calling for my husband — he needs a cleaning.",
      'His name is Michael Chen, date of birth March 12 1985.'
    ],
    expectedTools: ['schedule_appointment'],
    assertions: ['FAMILY_CALLER', 'NAME_DISAMBIGUATION'],
    skipIdentityAdmission: true
  },
  {
    id: 'DENTAL-009',
    title: 'Stedi timeout — desk callback offer',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'copay',
    stedi_timeout: true,
    utterances: [
      'Can you check my Delta Dental benefits?',
      'Member ID is DD987654321.'
    ],
    expectedTools: ['collect_insurance'],
    assertions: ['STEDI_DOWN_HANDOFF'],
    skipIdentityAdmission: true,
    thinEligibility: true
  },
  {
    id: 'DENTAL-010',
    title: 'Transfer to front desk',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'inquiry',
    utterances: ['Can I speak to someone at the front desk please?'],
    expectedTools: ['transfer_call'],
    assertions: ['WARM_TRANSFER'],
    skipIdentityAdmission: true
  },
  {
    id: 'DENTAL-011',
    title: 'Spanish bilingual — cleaning request',
    locale: 'es-US',
    language_mode: 'en_es',
    intent: 'booking',
    utterances: [
      'Hola, necesito una cita para una limpieza.',
      'Sí, la próxima semana por la mañana está bien.'
    ],
    expectedTools: ['schedule_appointment'],
    assertions: ['BILINGUAL_GREETING', 'BOOKING_OFFER'],
    skipIdentityAdmission: true
  }
];

/** @type {MultilangScenario[]} */
const MULTILANG_SCENARIOS = [
  {
    id: 'EN-1-booking',
    lang: 'en',
    intent: 'booking',
    extends: 'DENTAL-001',
    language_mode: 'en_only',
    locale: 'en-US',
    persona: 'Jennifer Walsh — new patient, wants a cleaning, has Cigna PPO',
    utterances: [
      "Hi, I'd like to book a cleaning. I haven't been to a dentist in about two years.",
      'My name is Jennifer Walsh, and I have Cigna PPO insurance.',
      'Yes, next Tuesday afternoon works great.'
    ],
    expectedTools: ['schedule_appointment'],
    toolsMustNotInclude: ['run_triage_rag'],
    expectAiDisclosure: true,
    expectedDisposition: 'booked',
    skipIdentityAdmission: true,
    evalTags: ['booking']
  },
  {
    id: 'EN-2-cancellation',
    lang: 'en',
    intent: 'cancellation',
    language_mode: 'en_only',
    locale: 'en-US',
    persona: 'David Chen — returning patient, cancels Thursday, asks to reschedule',
    utterances: [
      'I need to cancel my appointment for Thursday.',
      'Actually, can we just move it to next week instead?'
    ],
    expectedTools: ['reschedule_appointment'],
    optionalTools: ['search_appointments'],
    expectReschedule: true,
    expectAiDisclosure: true,
    expectedDisposition: 'rescheduled',
    requiresExistingAppointment: true,
    skipIdentityAdmission: true,
    evalTags: ['cancel']
  },
  {
    id: 'EN-3-copay-preinquiry',
    lang: 'en',
    intent: 'copay',
    extends: 'DENTAL-003',
    language_mode: 'en_only',
    locale: 'en-US',
    persona: 'Robert Kim — asks cost before agreeing to book',
    utterances: [
      'Before I book anything — how much would a cleaning cost me? I want to know before I commit.',
      'I have Aetna.'
    ],
    expectedTools: ['collect_insurance'],
    noFakeCopayIfThin: true,
    expectAiDisclosure: true,
    expectedDisposition: 'insurance_verified',
    skipIdentityAdmission: false,
    copayScenario: true,
    copayPayment: false,
    evalTags: ['copay_eligibility']
  },
  {
    id: 'EN-3-payment',
    lang: 'en',
    intent: 'copay',
    extends: 'DENTAL-003',
    language_mode: 'en_only',
    locale: 'en-US',
    persona: 'Robert Kim — copay quote then payment link',
    utterances: [
      'Before I book anything — how much would a cleaning cost me? I have Aetna.',
      'Yes, send me the payment link by text.'
    ],
    expectedTools: ['collect_insurance', 'request_patient_payment'],
    noFakeCopayIfThin: true,
    expectAiDisclosure: true,
    expectedDisposition: 'copay_pending',
    skipIdentityAdmission: false,
    copayScenario: true,
    copayPayment: true,
    checkSessionDeskParity: true,
    evalTags: ['copay_payment']
  },
  {
    id: 'EN-4-general-inquiry',
    lang: 'en',
    intent: 'inquiry',
    language_mode: 'en_only',
    locale: 'en-US',
    persona: 'Ashley Torres — hours, parking, Saturday availability',
    utterances: [
      'What are your hours, and is there parking nearby? Also, are you open Saturdays?'
    ],
    toolsMustNotInclude: ['schedule_appointment', 'request_patient_payment'],
    expectAiDisclosure: true,
    expectedDisposition: 'message_taken',
    skipIdentityAdmission: true,
    evalTags: ['inquiry']
  },
  {
    id: 'ES-1-booking',
    lang: 'es',
    intent: 'booking',
    extends: ['DENTAL-008', 'DENTAL-011'],
    language_mode: 'en_es',
    locale: 'es-US',
    family_caller: true,
    persona: 'Carmen Reyes — Spanish only, booking a cleaning for her son',
    utterances: [
      'Hola, quisiera hacer una cita de limpieza para mi hijo.',
      'Mi nombre es Carmen Reyes. Es la primera vez que viene a esta oficina.',
      'Sí, el martes por la tarde me viene bien.'
    ],
    expectedTools: ['schedule_appointment'],
    expectAiDisclosure: true,
    expectedDisposition: 'booked',
    skipIdentityAdmission: true,
    evalTags: ['booking']
  },
  {
    id: 'ES-2-copay',
    lang: 'es',
    intent: 'copay',
    extends: 'DENTAL-003',
    language_mode: 'en_es',
    locale: 'es-US',
    persona: 'Luis Fernández — Delta Dental, asks copay in Spanish',
    utterances: [
      'Buenos días. Quiero saber cuánto tendría que pagar por una limpieza. Tengo Delta Dental.'
    ],
    expectedTools: ['collect_insurance'],
    noFakeCopayIfThin: true,
    noCardOnCall: true,
    expectAiDisclosure: true,
    expectedDisposition: 'insurance_verified',
    skipIdentityAdmission: false,
    copayScenario: true,
    copayPayment: false,
    evalTags: ['copay_eligibility']
  },
  {
    id: 'ES-2-payment',
    lang: 'es',
    intent: 'copay',
    extends: 'DENTAL-003',
    language_mode: 'en_es',
    locale: 'es-US',
    persona: 'Luis Fernández — copay then payment link in Spanish',
    utterances: [
      'Buenos días. Quiero saber cuánto tendría que pagar por una limpieza. Tengo Delta Dental.',
      'Sí, envíenme el enlace de pago por mensaje de texto.'
    ],
    expectedTools: ['collect_insurance', 'request_patient_payment'],
    noFakeCopayIfThin: true,
    noCardOnCall: true,
    expectAiDisclosure: true,
    expectedDisposition: 'copay_pending',
    skipIdentityAdmission: false,
    copayScenario: true,
    copayPayment: true,
    checkSessionDeskParity: true,
    evalTags: ['copay_payment']
  },
  {
    id: 'ES-3-cancellation',
    lang: 'es',
    intent: 'cancellation',
    language_mode: 'en_es',
    locale: 'es-US',
    persona: 'Isabel Ortiz — cancels then immediately asks to reschedule',
    utterances: [
      'Necesito cancelar mi cita.',
      '¿Podemos cambiarla para la próxima semana?'
    ],
    expectedTools: ['reschedule_appointment'],
    optionalTools: ['search_appointments'],
    expectReschedule: true,
    expectAiDisclosure: true,
    expectedDisposition: 'rescheduled',
    requiresExistingAppointment: true,
    skipIdentityAdmission: true,
    evalTags: ['cancel']
  },
  {
    id: 'ES-4-inquiry-codeswitch',
    lang: 'es',
    intent: 'inquiry',
    language_mode: 'en_es',
    locale: 'es-US',
    persona: 'Miguel Santos — starts Spanish, switches to English mid-call',
    utterances: [
      'Hola, quería preguntar si aceptan seguro Medicaid.',
      "Actually, can I just give you my number in English? It's easier for me.",
      "It's five one six, five five five, oh one four eight."
    ],
    toolsMustNotInclude: ['schedule_appointment', 'request_patient_payment'],
    expectAiDisclosure: true,
    expectedDisposition: 'message_taken',
    skipIdentityAdmission: true,
    evalTags: ['inquiry']
  },
  {
    id: 'RU-1-booking',
    lang: 'ru',
    intent: 'booking',
    extends: 'DENTAL-005',
    language_mode: 'en_ru',
    locale: 'ru-RU',
    persona: 'Irina Volkov — books an exam',
    utterances: [
      'Здравствуйте, я хотела бы записаться на осмотр.',
      'Меня зовут Ирина Волкова.',
      'Да, вторник днём подходит.'
    ],
    expectedTools: ['schedule_appointment'],
    expectAiDisclosure: true,
    expectedDisposition: 'booked',
    skipIdentityAdmission: true,
    evalTags: ['booking']
  },
  {
    id: 'RU-2-copay',
    lang: 'ru',
    intent: 'copay',
    extends: 'DENTAL-003',
    language_mode: 'en_ru',
    locale: 'ru-RU',
    persona: 'Dmitri Petrov — MetLife, asks about coverage before booking',
    utterances: [
      'Здравствуйте, у меня страховка MetLife. Сколько будет стоить приём?'
    ],
    expectedTools: ['collect_insurance'],
    expectAiDisclosure: true,
    expectedDisposition: 'insurance_verified',
    skipIdentityAdmission: false,
    copayScenario: true,
    copayPayment: false,
    evalTags: ['copay_eligibility']
  },
  {
    id: 'RU-2-payment',
    lang: 'ru',
    intent: 'copay',
    extends: 'DENTAL-003',
    language_mode: 'en_ru',
    locale: 'ru-RU',
    persona: 'Dmitri Petrov — copay then payment link in Russian',
    utterances: [
      'Здравствуйте, у меня страховка MetLife. Сколько будет стоить приём?',
      'Да, пришлите ссылку для оплаты по SMS.'
    ],
    expectedTools: ['collect_insurance', 'request_patient_payment'],
    expectAiDisclosure: true,
    expectedDisposition: 'copay_pending',
    skipIdentityAdmission: false,
    copayScenario: true,
    copayPayment: true,
    checkSessionDeskParity: true,
    evalTags: ['copay_payment']
  },
  {
    id: 'RU-3-cancellation',
    lang: 'ru',
    intent: 'cancellation',
    language_mode: 'en_ru',
    locale: 'ru-RU',
    // Fee question on turn 2 — not a reschedule intent (distinct from EN-2 / ES-3).
    persona: 'Elena Sokolova — cancels due to conflict, asks about a fee',
    utterances: [
      'Мне нужно отменить приём, у меня изменились планы.',
      'Есть ли штраф за отмену?'
    ],
    expectedTools: ['cancel_appointment'],
    expectAiDisclosure: true,
    expectedDisposition: 'cancelled',
    requiresExistingAppointment: true,
    skipIdentityAdmission: true,
    evalTags: ['cancel']
  },
  {
    id: 'RU-4-inquiry',
    lang: 'ru',
    intent: 'inquiry',
    language_mode: 'en_ru',
    locale: 'ru-RU',
    persona: 'Pavel Kuznetsov — accessibility and language question',
    utterances: [
      'Здравствуйте, у вас есть доступ для инвалидных колясок? И на каких языках говорит врач?'
    ],
    toolsMustNotInclude: ['schedule_appointment'],
    expectAiDisclosure: true,
    expectedDisposition: 'message_taken',
    skipIdentityAdmission: true,
    evalTags: ['inquiry']
  },
  {
    id: 'ZH-1-fallback',
    lang: 'zh',
    intent: 'fallback-handling',
    language_mode: 'en_only',
    locale: 'zh-CN',
    persona: 'Wei Zhang — opens in Mandarin on en_only tenant',
    utterances: ['你好，我想预约洗牙。'],
    expectForceLanguageHandoff: true,
    expectAiDisclosure: true,
    expectedDisposition: 'handoff',
    skipPhiScan: true,
    skipIdentityAdmission: true,
    evalTags: ['inquiry']
  }
];

function registryHash() {
  const payload = JSON.stringify({ dental: DENTAL_PSTN_SCENARIOS, multilang: MULTILANG_SCENARIOS });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function getScenarioById(id) {
  return (
    DENTAL_PSTN_SCENARIOS.find((s) => s.id === id) ||
    MULTILANG_SCENARIOS.find((s) => s.id === id) ||
    null
  );
}

function listMultilangScenarios(filters = {}) {
  let list = [...MULTILANG_SCENARIOS];
  if (filters.lang) list = list.filter((s) => s.lang === filters.lang);
  if (filters.intent) list = list.filter((s) => s.intent === filters.intent);
  if (filters.id) list = list.filter((s) => s.id === filters.id);
  if (filters.tag) {
    list = list.filter((s) => (s.evalTags || []).includes(filters.tag));
  }
  return list;
}

module.exports = {
  DENTAL_PSTN_SCENARIOS,
  MULTILANG_SCENARIOS,
  registryHash,
  getScenarioById,
  listMultilangScenarios
};
