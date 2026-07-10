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
  },
  {
    id: 'DENTAL-012',
    title: 'Endodontics — root canal (D3310)',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'copay',
    utterances: [
      'I need a root canal on my back molar.',
      'My Delta Dental member ID is DD445566778.'
    ],
    expectedTools: ['collect_insurance'],
    assertions: ['COPAY_QUOTE', 'ENDO_CDT'],
    skipIdentityAdmission: true,
    evalTags: ['endo', 'cdt']
  },
  {
    id: 'DENTAL-013',
    title: 'Periodontics — deep cleaning (D4341)',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'copay',
    utterances: [
      'My dentist said I need a deep cleaning for gum disease.',
      'I have Aetna dental, member ID AE998877665.'
    ],
    expectedTools: ['collect_insurance'],
    assertions: ['PERIO_CDT', 'PAYER_COLLECT'],
    skipIdentityAdmission: true,
    evalTags: ['perio', 'cdt']
  },
  {
    id: 'DENTAL-014',
    title: 'Orthodontics — braces consult (D9310)',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'booking',
    utterances: [
      'I want a consultation for braces for my teenager.',
      'We have MetLife dental.'
    ],
    expectedTools: ['schedule_appointment'],
    assertions: ['ORTHO_CONSULT', 'BOOKING_OFFER'],
    skipIdentityAdmission: true,
    evalTags: ['ortho', 'cdt']
  },
  {
    id: 'DENTAL-015',
    title: 'Payer not seeded — desk callback',
    locale: 'en-US',
    language_mode: 'en_only',
    intent: 'copay',
    payer_not_seeded: true,
    utterances: [
      'Do you take Guardian dental insurance?',
      'Member ID is GU112233445.'
    ],
    expectedTools: ['collect_insurance'],
    assertions: ['PAYER_NOT_SEEDED', 'DESK_CALLBACK'],
    skipIdentityAdmission: true,
    evalTags: ['payer_not_seeded']
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
      'Yes, Tuesday at 12:00 works great.'
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
      'Sí, el martes a las 12:00 me viene bien.'
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
      'Да, во вторник в 12:00 подходит.'
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
    id: 'ZH-1-booking',
    lang: 'zh',
    intent: 'booking',
    language_mode: 'en_zh',
    locale: 'zh-CN',
    persona: 'Wei Zhang — books a dental cleaning in Mandarin',
    utterances: [
      '你好，我想预约洗牙。',
      '我叫张伟，我是新患者。',
      '好的，周二12点可以。'
    ],
    expectedTools: ['schedule_appointment'],
    expectAiDisclosure: true,
    expectedDisposition: 'booked',
    skipIdentityAdmission: true,
    evalTags: ['booking']
  },
  {
    id: 'ZH-2-copay',
    lang: 'zh',
    intent: 'copay',
    extends: 'DENTAL-003',
    language_mode: 'en_zh',
    locale: 'zh-CN',
    persona: 'Li Mei — asks copay before booking in Mandarin',
    utterances: ['你好，洗牙大概要自付多少钱？我有 Aetna 保险。'],
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
    id: 'ZH-2-payment',
    lang: 'zh',
    intent: 'copay',
    extends: 'DENTAL-003',
    language_mode: 'en_zh',
    locale: 'zh-CN',
    persona: 'Li Mei — copay quote then SMS payment link in Mandarin',
    utterances: [
      '你好，洗牙大概要自付多少钱？我有 Aetna 保险。',
      '好的，请发短信给我支付链接。'
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
    id: 'ZH-3-cancellation',
    lang: 'zh',
    intent: 'cancellation',
    language_mode: 'en_zh',
    locale: 'zh-CN',
    persona: 'Chen Wei — cancels then reschedules in Mandarin',
    utterances: ['我需要取消预约。', '可以改到下周吗？'],
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
    id: 'EN-records-derm',
    lang: 'en',
    intent: 'records',
    language_mode: 'en_only',
    locale: 'en-US',
    use_case: 'dermatology',
    persona: 'Patient asks about last visit notes (dermatology clinical tenant)',
    utterances: ['Can you tell me what my doctor noted from my last visit?'],
    expectedTools: ['query_patient_records'],
    toolsMustNotInclude: ['run_triage_rag', 'schedule_appointment'],
    expectAiDisclosure: true,
    skipIdentityAdmission: true,
    evalTags: ['records_qa']
  },
  {
    id: 'ES-records-derm',
    lang: 'es',
    intent: 'records',
    language_mode: 'en_es',
    locale: 'es-US',
    use_case: 'dermatology',
    persona: 'Paciente pregunta por resultados de la última visita',
    utterances: ['¿Pueden decirme qué anotó el doctor en mi última visita?'],
    expectedTools: ['query_patient_records'],
    toolsMustNotInclude: ['schedule_appointment'],
    expectAiDisclosure: true,
    skipIdentityAdmission: true,
    evalTags: ['records_qa']
  },
  {
    id: 'RU-records-derm',
    lang: 'ru',
    intent: 'records',
    language_mode: 'en_ru',
    locale: 'ru-RU',
    use_case: 'dermatology',
    persona: 'Пациент спрашивает о последнем визите',
    utterances: ['Можете сказать, что записал врач на моём последнем приёме?'],
    expectedTools: ['query_patient_records'],
    toolsMustNotInclude: ['schedule_appointment'],
    expectAiDisclosure: true,
    skipIdentityAdmission: true,
    evalTags: ['records_qa']
  },
  {
    id: 'ZH-records-derm',
    lang: 'zh',
    intent: 'records',
    language_mode: 'en_zh',
    locale: 'zh-CN',
    use_case: 'dermatology',
    persona: '患者询问上次就诊记录',
    utterances: ['能告诉我上次就诊医生记录了什么吗？'],
    expectedTools: ['query_patient_records'],
    toolsMustNotInclude: ['schedule_appointment'],
    expectAiDisclosure: true,
    skipIdentityAdmission: true,
    evalTags: ['records_qa']
  },
  {
    id: 'EN-records-clinic',
    lang: 'en',
    intent: 'records',
    language_mode: 'en_only',
    locale: 'en-US',
    use_case: 'healthcare_clinic',
    persona: 'Patient asks about lab results at medical clinic',
    utterances: ['What did my lab results show from my last visit?'],
    expectedTools: ['query_patient_records'],
    toolsMustNotInclude: ['run_triage_rag'],
    expectAiDisclosure: true,
    skipIdentityAdmission: true,
    evalTags: ['records_qa']
  },
  {
    id: 'ES-records-clinic',
    lang: 'es',
    intent: 'records',
    language_mode: 'en_es',
    locale: 'es-US',
    use_case: 'healthcare_clinic',
    persona: 'Paciente pregunta por resultados de laboratorio',
    utterances: ['¿Qué mostraron mis resultados de laboratorio de la última visita?'],
    expectedTools: ['query_patient_records'],
    expectAiDisclosure: true,
    skipIdentityAdmission: true,
    evalTags: ['records_qa']
  },
  {
    id: 'RU-records-clinic',
    lang: 'ru',
    intent: 'records',
    language_mode: 'en_ru',
    locale: 'ru-RU',
    use_case: 'healthcare_clinic',
    persona: 'Пациент спрашивает о результатах анализов',
    utterances: ['Что показали мои анализы с последнего визита?'],
    expectedTools: ['query_patient_records'],
    expectAiDisclosure: true,
    skipIdentityAdmission: true,
    evalTags: ['records_qa']
  },
  {
    id: 'ZH-records-clinic',
    lang: 'zh',
    intent: 'records',
    language_mode: 'en_zh',
    locale: 'zh-CN',
    use_case: 'healthcare_clinic',
    persona: '患者询问化验结果',
    utterances: ['我上次的化验结果怎么样？'],
    expectedTools: ['query_patient_records'],
    expectAiDisclosure: true,
    skipIdentityAdmission: true,
    evalTags: ['records_qa']
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
    evalTags: ['inquiry', 'handoff_only'],
    evalOptional: true
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
  if (!filters.includeOptional) {
    list = list.filter((s) => !s.evalOptional);
  }
  if (!filters.tag && !filters.includeRecords) {
    list = list.filter((s) => !(s.evalTags || []).includes('records_qa'));
  }
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
