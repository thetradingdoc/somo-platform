/**
 * 4-step state machine for Safe VideoGPT for Healthcare.
 */
export const STEPS = ['terms', 'call', 'chat', 'report'];

export function createSessionState() {
  return {
    step: 'terms',
    session: null,
    sessionToken: null,
    sseToken: null,
    sseUrl: null,
    livekit: null,
    report: null,
    locale: 'en',
    replyLanguage: 'en'
  };
}

export function setStep(state, step) {
  if (!STEPS.includes(step)) return state;
  return { ...state, step };
}

export function applyStartResponse(state, data) {
  return {
    ...state,
    step: 'call',
    session: data.session,
    sessionToken: data.session_token,
    sseToken: data.sse_token,
    sseUrl: data.sse_url,
    livekit: data.livekit
  };
}

export function applyReport(state, session) {
  return {
    ...state,
    step: 'report',
    report: session?.report || null,
    session
  };
}
