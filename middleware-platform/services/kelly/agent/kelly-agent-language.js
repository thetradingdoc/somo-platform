'use strict';

function languageDirective(preferredLanguage) {
  const code = String(preferredLanguage || 'en').toLowerCase();
  if (!code || code === 'en') return '';
  const map = {
    ru: `## Текущий язык / Current language (MANDATORY)
The patient is speaking Russian. You MUST reply ONLY in Russian for every message in this session.
Use natural spoken Russian. Keep Latin for emails, phone numbers, and proper nouns if given that way.
If they just asked to switch to Russian, start with a short Russian acknowledgment, then continue care in Russian.`,
    es: `## Idioma actual (OBLIGATORIO)
Responde SOLO en español durante toda la sesión.`,
    fr: `## Langue actuelle (OBLIGATOIRE)
Répondez UNIQUEMENT en français pendant toute la session.`,
    sw: `## Luaga (LAZIMA)
Jibu kwa Kiswahili tu kwa kipindi hicho.`,
    de: `## Aktuelle Sprache (VERBINDLICH)
Antworten Sie durchgehend auf Deutsch.`,
    zh: `## 当前语言（必须）
全程使用中文回复患者。`
  };
  return map[code] || `## Current language (MANDATORY)\nRespond ONLY in language "${code}" for the entire session. Do not use English unless the patient switches back to English.`;
}

function detectPreferredLanguage(history, currentMessage) {
  try {
    const { detectLanguagePreferenceRequest } = require('../../patient/patient-orchestrator-service');
    const langReq = detectLanguagePreferenceRequest(String(currentMessage || ''));
    if (langReq?.isLanguageRequest && langReq?.code) return langReq.code;
  } catch (_) {}

  const lastAssistantMsg = [...(history || [])].reverse().find((m) => m.role === 'assistant');
  if (lastAssistantMsg?.language) return lastAssistantMsg.language;

  const t = currentMessage || '';
  if (/\p{Script=Cyrillic}/u.test(t)) return 'ru';
  if (/(?:можем|можно)\s+(?:говорить|общаться)\s+(?:по-русски|на\s+русском)/i.test(t)) return 'ru';
  if (/\b(говорить|говорите)\s+по-русски\b/i.test(t)) return 'ru';
  if (/\bна\s+русском\s+(?:языке)?\b/i.test(t)) return 'ru';
  if (/\b(russian|speak russian|in russian|to russian|russki|русск)\b/i.test(t)) return 'ru';
  if (/[\u4e00-\u9fff]/.test(t)) return 'zh';
  if (/^(hola|buenos|gracias|por favor|necesito|dolor|quiero)\b/i.test(t)) return 'es';
  if (/^(bonjour|merci|je veux|oui|non)\b/i.test(t)) return 'fr';
  if (/^(guten|danke|ich bin|hallo)\b/i.test(t)) return 'de';
  if (/\b(nataka|daktari|maumivu|msaada|habari|ndiyo|hapana|asante|tafadhali|ninajua|ninaweza)\b/i.test(t)) return 'sw';
  return 'en';
}

module.exports = { languageDirective, detectPreferredLanguage };
