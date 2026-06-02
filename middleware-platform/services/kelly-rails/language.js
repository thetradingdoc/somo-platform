'use strict';

const SPANISH_HINTS = [
  'hola', 'buenos', 'buenas', 'dolor', 'fiebre', 'tos', 'quiero',
  'cita', 'doctor', 'pagar', 'factura', 'ayuda', 'gracias', 'por favor'
];
const PORTUGUESE_HINTS = [
  'ola', 'olá', 'dor', 'febre', 'consulta', 'marcar', 'pagar', 'fatura',
  'obrigado', 'por favor', 'ajuda'
];
const MANDARIN_HINTS = ['你好', '医生', '预约', '疼', '发烧', '付款', '谢谢'];

function detectLanguage(message) {
  const text = String(message || '').trim();
  if (!text) return { language: 'en', confidence: 0 };
  const lower = text.toLowerCase();

  if (MANDARIN_HINTS.some((h) => text.includes(h))) {
    return { language: 'zh', confidence: 0.95 };
  }
  if (SPANISH_HINTS.some((h) => lower.includes(h))) {
    return { language: 'es', confidence: 0.85 };
  }
  if (PORTUGUESE_HINTS.some((h) => lower.includes(h))) {
    return { language: 'pt', confidence: 0.8 };
  }
  return { language: 'en', confidence: 0.75 };
}

function minLanguageConfidence() {
  const v = parseFloat(process.env.KELLY_LANG_MIN_CONFIDENCE || '0.6');
  return Number.isFinite(v) ? v : 0.6;
}

module.exports = {
  detectLanguage,
  minLanguageConfidence
};

