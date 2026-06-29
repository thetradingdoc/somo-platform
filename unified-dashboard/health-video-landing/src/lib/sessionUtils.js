const TOPIC_KEYWORDS = [
  'rash', 'pain', 'itch', 'itchy', 'fever', 'skin', 'private', 'groin',
  'chest', 'headache', 'nausea', 'cough', 'swelling', 'burning', 'discharge',
  'fatigue', 'dizzy', 'stiff', 'throat', 'stomach', 'medication'
];

const GREETING_ID = 'greeting-local';

export const THINKING_LINES = [
  'Somo is reviewing your symptoms…',
  'Considering possible causes…',
  'Preparing next question…',
  'Checking for urgent concerns…'
];

export function buildTopicChips(messages) {
  const patientLines = messages
    .filter((m) => m.speaker === 'patient' && m.text?.trim())
    .map((m) => m.text.trim());

  const topics = [];
  for (const line of patientLines) {
    const lower = line.toLowerCase();
    for (const kw of TOPIC_KEYWORDS) {
      const label = kw.charAt(0).toUpperCase() + kw.slice(1);
      if (lower.includes(kw) && !topics.includes(label)) topics.push(label);
    }
    if (topics.length >= 5) break;
  }

  if (patientLines[0] && topics.length < 4) {
    const excerpt = patientLines[0].slice(0, 48);
    if (!topics.includes(excerpt)) topics.unshift(excerpt);
  }

  if (!topics.length) return ['Health chat'];
  return topics.slice(0, 6);
}

export function somoGreeting(displayName) {
  const name = displayName?.trim();
  const hi = name ? `Hi ${name}.` : 'Hi.';
  return `${hi} I'm Somo, your AI health assistant.

Tell me what's bothering you today. You can type, speak, or turn on your camera if you'd like me to take a closer look.`;
}

/** @deprecated use somoGreeting */
export const kellyGreeting = somoGreeting;

export function isGreetingLike(text) {
  const t = String(text || '').toLowerCase();
  return t.includes("i'm somo")
    || t.includes("i'm kelly")
    || t.includes('tell me what')
    || t.includes('bothering you')
    || t.includes('health concerns')
    || t.includes('what brings you');
}

export function normalizeSomoCopy(text) {
  return String(text || '')
    .replace(/\bphysician assistant\b/gi, 'AI health assistant')
    .replace(/\bKelly\b/g, 'Somo')
    .replace(/\bkelly\b/g, 'somo');
}

/** @deprecated use normalizeSomoCopy */
export const normalizeKellyCopy = normalizeSomoCopy;

export function mergeAssistantMessage(prev, text) {
  const trimmed = normalizeSomoCopy(String(text || '').trim());
  if (!trimmed) return prev;

  if (isGreetingLike(trimmed)) {
    const localIdx = prev.findIndex((m) => m.id === GREETING_ID);
    if (localIdx >= 0) {
      const next = [...prev];
      next[localIdx] = { ...next[localIdx], text: trimmed };
      return next;
    }
    const greetIdx = prev.findIndex((m) => m.speaker === 'assistant' && isGreetingLike(m.text));
    if (greetIdx >= 0) {
      const next = [...prev];
      next[greetIdx] = { ...next[greetIdx], text: trimmed };
      return next;
    }
  }

  const last = prev[prev.length - 1];
  if (last?.speaker === 'assistant' && last.text === trimmed) return prev;

  return [...prev, { id: `msg-${Date.now()}`, speaker: 'assistant', text: trimmed }];
}

export function createLocalGreeting(displayName) {
  return {
    id: GREETING_ID,
    speaker: 'assistant',
    text: somoGreeting(displayName)
  };
}

export function isMemoryMessage(text) {
  const t = String(text || '').toLowerCase();
  return t.includes('you mentioned') || t.includes('earlier you') || t.includes('you said');
}
