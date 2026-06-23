const LLMRouter = require('../shared/llm-router');

const FIELD_PROMPTS = {
  chief_complaint: 'Ask one concise question to capture the main complaint or concern.',
  body_sites: 'Ask one concise question to capture the body area(s) affected.',
  severity: 'Ask one concise question to capture symptom severity, ideally on a 1-10 scale.',
  timeline: 'Ask one concise question to capture onset/timeline (when it started and pattern).'
};

const LOCALIZED_FALLBACKS = {
  en: {
    chief_complaint: 'What is the main symptom or concern you want help with today?',
    body_sites: 'Which part of your body is affected?',
    severity: 'How severe is it right now on a scale from 1 to 10?',
    timeline: 'When did this start, and is it constant or does it come and go?',
    generic: 'Could you share one more detail so I can continue your assessment?'
  },
  fr: {
    chief_complaint: "Quel est le symptome ou le probleme principal aujourd'hui ?",
    body_sites: 'Quelle partie de votre corps est touchee ?',
    severity: "Quelle est l'intensite actuelle sur une echelle de 1 a 10 ?",
    timeline: 'Quand cela a-t-il commence, et est-ce constant ou intermittent ?',
    generic: 'Pouvez-vous partager un detail de plus pour continuer votre evaluation ?'
  },
  ru: {
    chief_complaint: 'Какой основной симптом или проблема беспокоит вас сегодня?',
    body_sites: 'Какая часть тела затронута?',
    severity: 'Насколько сильно это сейчас по шкале от 1 до 10?',
    timeline: 'Когда это началось, и это постоянно или периодически?',
    generic: 'Можете сообщить еще одну деталь, чтобы продолжить оценку?'
  },
  sw: {
    chief_complaint: 'Dalili au tatizo kuu linalokusumbua leo ni nini?',
    body_sites: 'Ni sehemu gani ya mwili imeathirika?',
    severity: 'Kwa sasa ni kali kiasi gani kwa kipimo cha 1 hadi 10?',
    timeline: 'Hii ilianza lini, na ni ya kudumu au huja na kuondoka?',
    generic: 'Tafadhali toa maelezo moja zaidi ili niendelee na tathmini yako.'
  }
};

function normalizeLang(preferredLanguage) {
  const code = String(preferredLanguage || 'en').trim().toLowerCase().split('-')[0];
  return LOCALIZED_FALLBACKS[code] ? code : 'en';
}

async function generateQuestion({ missingField, pathway = 'triage', preferredLanguage = 'en' } = {}) {
  const lang = normalizeLang(preferredLanguage);
  const instruction = FIELD_PROMPTS[missingField] || 'Ask one concise question for the next missing intake field.';
  const system = `You are a clinical intake assistant. Return exactly one short question and nothing else.`;
  const user = `Pathway: ${pathway}. Language: ${lang}. ${instruction}`;
  try {
    const out = await LLMRouter.call({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      maxTokens: 80,
      channel: 'chat'
    });
    const text = String(out?.text || '').trim();
    if (text) return text;
  } catch (_) {}

  // Safe deterministic fallback
  const dict = LOCALIZED_FALLBACKS[lang] || LOCALIZED_FALLBACKS.en;
  if (missingField === 'chief_complaint') return dict.chief_complaint;
  if (missingField === 'body_sites') return dict.body_sites;
  if (missingField === 'severity') return dict.severity;
  if (missingField === 'timeline') return dict.timeline;
  return dict.generic;
}

module.exports = {
  generateQuestion
};
