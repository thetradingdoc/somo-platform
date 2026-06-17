'use strict';

const EN = {
  booking_confirmed: 'Your appointment is confirmed for {when}.',
  payment_link_sent:
    'I sent a secure payment link for ${amount}. Open the link to pay — I will not collect card numbers here.',
  appt_found: 'I found your {type} scheduled for {when}. Does that match what you were expecting?',
  appt_found_short: 'I found your upcoming {type}. Does that match what you were expecting?',
  appt_canceled: 'Your appointment has been canceled.',
  cancel_then_rebook: 'Your appointment has been canceled. Let me find a new time for you.',
  appt_rescheduled: 'Your appointment has been rescheduled to {when}.',
  slot_conflict: 'That time is no longer available. Here are some alternatives: {slots}',
  provider_mismatch: 'I could not book with {provider}. Here are available times with other providers: {slots}',
  slots_offered: 'Which of these works best for you?',
  no_slots_available:
    'I do not see any bookable openings right now. I can connect you with our front desk to help find a time.',
  schedule_failed:
    'I was not able to complete that booking in our system. I can connect you with our front desk to finish scheduling.',
  gate_processing:
    'I need a moment to complete that in our system. Can you confirm your phone number or email on file?',
  records_answer: '{answer}',
  records_empty: 'I could not find any records matching that question on file.',
  lookup_missing_id:
    'Can you confirm your name or the phone number on your account so I can look up your appointment?',
  lookup_not_found:
    'I could not find an upcoming appointment on file. Can you confirm your name or the phone number we have for you?'
};

const ES = {
  booking_confirmed: 'Su cita está confirmada para {when}.',
  payment_link_sent:
    'Le envié un enlace de pago seguro por ${amount}. Abra el enlace para pagar; no recopilo números de tarjeta aquí.',
  appt_found: 'Encontré su cita de {type} programada para {when}. ¿Coincide con lo que esperaba?',
  appt_found_short: 'Encontré su próxima cita de {type}. ¿Coincide con lo que esperaba?',
  appt_canceled: 'Su cita ha sido cancelada.',
  cancel_then_rebook: 'Su cita ha sido cancelada. Déjeme buscar un nuevo horario.',
  appt_rescheduled: 'Su cita ha sido reprogramada para {when}.',
  slot_conflict: 'Ese horario ya no está disponible. Estas son algunas alternativas: {slots}',
  provider_mismatch: 'No pude reservar con {provider}. Estos son horarios con otros proveedores: {slots}',
  slots_offered: '¿Cuál de estos le funciona mejor?',
  no_slots_available:
    'No veo horarios disponibles en este momento. Puedo conectarle con recepción para ayudarle a encontrar un horario.',
  schedule_failed:
    'No pude completar esa reserva en nuestro sistema. Puedo conectarle con recepción para terminar de programar.',
  gate_processing:
    'Necesito un momento para completar eso en nuestro sistema. ¿Puede confirmar su teléfono o correo electrónico?',
  records_answer: '{answer}',
  records_empty: 'No encontré registros que coincidan con esa pregunta.',
  lookup_missing_id:
    '¿Puede confirmar su nombre o el número de teléfono de su cuenta para buscar su cita?',
  lookup_not_found:
    'No encontré una cita próxima. ¿Puede confirmar su nombre o el teléfono que tenemos registrado?'
};

const ZH = {
  booking_confirmed: '您的预约已确认，时间为 {when}。',
  payment_link_sent: '我已发送 ${amount} 的安全付款链接。请打开链接付款，我不会在此收集卡号。',
  appt_found: '我找到了您预约的{type}，时间为 {when}。这与您预期的一致吗？',
  appt_found_short: '我找到了您即将进行的{type}预约。这与您预期的一致吗？',
  appt_canceled: '您的预约已取消。',
  cancel_then_rebook: '您的预约已取消。让我为您查找新的时间。',
  appt_rescheduled: '您的预约已改期至 {when}。',
  slot_conflict: '该时间已不可用。以下是一些替代时间：{slots}',
  provider_mismatch: '无法为您预约{provider}。以下是其他医生的可用时间：{slots}',
  slots_offered: '哪个时间对您最合适？',
  no_slots_available: '目前没有可预约的时间。我可以为您转接前台协助安排。',
  schedule_failed: '我无法在系统中完成该预约。我可以为您转接前台完成安排。',
  gate_processing: '我需要在系统中处理一下。请确认您存档的电话或邮箱。',
  records_answer: '{answer}',
  records_empty: '我在档案中没有找到与该问题匹配的记录。',
  lookup_missing_id: '请确认您的姓名或账户电话号码，以便我查找您的预约。',
  lookup_not_found: '我没有找到即将进行的预约。请确认您的姓名或我们存档的电话号码。'
};

const TABLES = { en: EN, es: ES, zh: ZH };

function getDeterministicReply(key, locale = 'en', vars = {}) {
  const loc = String(locale || 'en').slice(0, 2);
  const table = TABLES[loc] || EN;
  let msg = table[key] || EN[key] || '';
  for (const [k, v] of Object.entries(vars)) {
    msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
    msg = msg.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), String(v ?? ''));
  }
  return msg;
}

module.exports = { getDeterministicReply, EN, ES, ZH };
