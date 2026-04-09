import { setAssistantSpeaking } from './sphereConversationBridge';

/**
 * Landing TTS: POST /api/public/landing-assistant/tts-stream (OpenAI MP3; server pipes upstream).
 * Client reads the response body as a stream, then plays via Blob URL (playback still needs full MP3).
 * stopAssistantSpeech() aborts the fetch and stops playback. Falls back to speechSynthesis on failure.
 */
let activeAudio = null;
let activeAudioUrl = null;
let activeUtterance = null;
/** AbortController for in-flight TTS fetch (streaming body read). */
let activeTtsAbort = null;
let activeReader = null;
let activeMediaSource = null;
let activeSourceBuffer = null;

function browserSpeechFallback(text, lang) {
  try {
    if (typeof window === 'undefined' || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return false;
    const u = new window.SpeechSynthesisUtterance(String(text || ''));
    u.lang = String(lang || 'en-US');
    u.rate = 1.0;
    u.pitch = 1.0;
    activeUtterance = u;
    u.onstart = () => setAssistantSpeaking(true);
    const done = () => {
      setAssistantSpeaking(false);
      if (activeUtterance === u) activeUtterance = null;
    };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
    return true;
  } catch (_) {
    return false;
  }
}

function supportsProgressiveMpegPlayback() {
  try {
    if (typeof window === 'undefined' || !window.MediaSource || !window.MediaSource.isTypeSupported) return false;
    return window.MediaSource.isTypeSupported('audio/mpeg');
  } catch (_) {
    return false;
  }
}

export async function speakAssistantReply(
  text,
  { lang = 'en-US', apiBase = '', onFirstByte = null, onAudioStart = null, onPlaybackReady = null, onTtsMeta = null } = {}
) {
  if (typeof window === 'undefined') return;
  const t = String(text || '').trim();
  if (!t) return;
  const base = String(apiBase || '').replace(/\/$/, '');
  if (!base) return;
  stopAssistantSpeech();
  const ac = new AbortController();
  activeTtsAbort = ac;
  try {
    const r = await fetch(`${base}/api/public/landing-assistant/tts-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ text: t, lang }),
      signal: ac.signal
    });
    if (!r.ok) {
      browserSpeechFallback(t, lang);
      return;
    }
    if (typeof onTtsMeta === 'function') {
      const ttsMeta = {
        ttsVoice: String(r.headers.get('x-tts-voice') || '').trim(),
        ttsModel: String(r.headers.get('x-tts-model') || '').trim(),
        ttsLang: String(r.headers.get('x-tts-lang') || '').trim().toLowerCase()
      };
      try { onTtsMeta(ttsMeta); } catch (_) {}
    }
    const body = r.body;
    if (!body || !body.getReader) {
      if (typeof onFirstByte === 'function') {
        try { onFirstByte(); } catch (_) {}
      }
      const blob = await r.blob();
      if (typeof onPlaybackReady === 'function') {
        try { onPlaybackReady(); } catch (_) {}
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudio = audio;
      activeAudioUrl = url;
      audio.onplay = () => {
        setAssistantSpeaking(true);
        if (typeof onAudioStart === 'function') {
          try { onAudioStart(); } catch (_) {}
        }
      };
      const clear = () => {
        setAssistantSpeaking(false);
        if (activeAudio === audio) activeAudio = null;
        if (activeAudioUrl === url) {
          URL.revokeObjectURL(url);
          activeAudioUrl = null;
        }
      };
      audio.onended = clear;
      audio.onerror = clear;
      await audio.play().catch(() => {
        clear();
        browserSpeechFallback(t, lang);
      });
      return;
    }
    const reader = body.getReader();
    activeReader = reader;
    if (supportsProgressiveMpegPlayback()) {
      const mediaSource = new window.MediaSource();
      activeMediaSource = mediaSource;
      const url = URL.createObjectURL(mediaSource);
      const audio = new Audio(url);
      activeAudio = audio;
      activeAudioUrl = url;
      audio.onplay = () => {
        setAssistantSpeaking(true);
        if (typeof onAudioStart === 'function') {
          try { onAudioStart(); } catch (_) {}
        }
      };
      const clear = () => {
        setAssistantSpeaking(false);
        if (activeAudio === audio) activeAudio = null;
        if (activeAudioUrl === url) {
          URL.revokeObjectURL(url);
          activeAudioUrl = null;
        }
        if (activeMediaSource === mediaSource) activeMediaSource = null;
        if (activeSourceBuffer) activeSourceBuffer = null;
      };
      audio.onended = clear;
      audio.onerror = clear;

      let started = false;
      let firstByteMarked = false;
      let sourceOpenResolved = false;
      const pendingChunks = [];
      let sourceBuffer = null;
      activeSourceBuffer = null;

      const appendIfPossible = () => {
        if (!sourceBuffer || sourceBuffer.updating || !pendingChunks.length) return;
        const next = pendingChunks.shift();
        try {
          sourceBuffer.appendBuffer(next);
        } catch (_) {
          // If append fails (browser codec quirks), audio.onerror path handles fallback/cleanup.
        }
      };

      const waitForSourceOpen = new Promise((resolve) => {
        const onOpen = () => {
          sourceOpenResolved = true;
          try {
            sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
            activeSourceBuffer = sourceBuffer;
            sourceBuffer.mode = 'sequence';
            sourceBuffer.addEventListener('updateend', () => {
              appendIfPossible();
            });
          } catch (_) {}
          resolve();
        };
        mediaSource.addEventListener('sourceopen', onOpen, { once: true });
      });

      await audio.play().catch(() => {});
      await waitForSourceOpen;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        if (!firstByteMarked) {
          firstByteMarked = true;
          if (typeof onFirstByte === 'function') {
            try { onFirstByte(); } catch (_) {}
          }
        }
        pendingChunks.push(value);
        appendIfPossible();
        if (!started) {
          started = true;
          await audio.play().catch(() => {});
        }
      }
      const finishSource = () => {
        if (!sourceOpenResolved || !mediaSource || mediaSource.readyState !== 'open') return;
        if (sourceBuffer && sourceBuffer.updating) {
          const onUpdateEnd = () => {
            sourceBuffer.removeEventListener('updateend', onUpdateEnd);
            finishSource();
          };
          sourceBuffer.addEventListener('updateend', onUpdateEnd);
          return;
        }
        try {
          mediaSource.endOfStream();
        } catch (_) {}
        if (typeof onPlaybackReady === 'function') {
          try { onPlaybackReady(); } catch (_) {}
        }
      };
      finishSource();
      return;
    }

    // Fallback: read full response and play as blob.
    const chunks = [];
    let firstByteMarked = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        chunks.push(value);
        if (!firstByteMarked) {
          firstByteMarked = true;
          if (typeof onFirstByte === 'function') {
            try { onFirstByte(); } catch (_) {}
          }
        }
      }
    }
    if (typeof onPlaybackReady === 'function') {
      try { onPlaybackReady(); } catch (_) {}
    }
    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio = audio;
    activeAudioUrl = url;
    audio.onplay = () => {
      setAssistantSpeaking(true);
      if (typeof onAudioStart === 'function') {
        try { onAudioStart(); } catch (_) {}
      }
    };
    const clear = () => {
      setAssistantSpeaking(false);
      if (activeAudio === audio) activeAudio = null;
      if (activeAudioUrl === url) {
        URL.revokeObjectURL(url);
        activeAudioUrl = null;
      }
    };
    audio.onended = clear;
    audio.onerror = clear;
    await audio.play().catch(() => {
      clear();
      browserSpeechFallback(t, lang);
    });
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    if (!browserSpeechFallback(t, lang)) setAssistantSpeaking(false);
  } finally {
    activeReader = null;
    activeTtsAbort = null;
  }
}

export function stopAssistantSpeech() {
  if (typeof window === 'undefined') return;
  if (activeTtsAbort) {
    try {
      activeTtsAbort.abort();
    } catch (_) {}
    activeTtsAbort = null;
  }
  if (activeReader) {
    try { activeReader.cancel(); } catch (_) {}
    activeReader = null;
  }
  if (activeSourceBuffer) {
    try {
      if (activeSourceBuffer.updating) {
        activeSourceBuffer.abort();
      }
    } catch (_) {}
    activeSourceBuffer = null;
  }
  if (activeMediaSource) {
    try {
      if (activeMediaSource.readyState === 'open') activeMediaSource.endOfStream();
    } catch (_) {}
    activeMediaSource = null;
  }
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    } catch (_) {}
    activeAudio = null;
  }
  if (activeAudioUrl) {
    try { URL.revokeObjectURL(activeAudioUrl); } catch (_) {}
    activeAudioUrl = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
  activeUtterance = null;
  setAssistantSpeaking(false);
}

export async function waitForAssistantSpeechToFinish({ timeoutMs = 8000 } = {}) {
  if (typeof window === 'undefined') return;
  const start = Date.now();
  while (activeAudio && !activeAudio.paused) {
    if (Date.now() - start > timeoutMs) break;
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
}
