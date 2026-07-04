/**
 * Shared provider post-login / onboarding destination resolver (FD-044–047).
 */
(function (global) {
  const DEFAULT_HOME = '/business/today.html';
  const GO_LIVE_HASH = '#go-live-checklist';

  function apiBase() {
    const base =
      (typeof global.resolveApiBase === 'function' && global.resolveApiBase()) ||
      global.API_BASE ||
      global.location?.origin ||
      '';
    return String(base).replace(/\/$/, '');
  }

  function isTerminalOnboardingState(state) {
    return state === 'voice_setup_complete' || state === 'live';
  }

  function isIncompleteOnboardingState(state) {
    return (
      state === 'voice_setup_incomplete' ||
      state === 'activation_shown' ||
      state === 'terms_accepted' ||
      state === 'line_assigned' ||
      state === 'signup_started' ||
      state === 'provisioning_failed' ||
      state === 'sync_failed'
    );
  }

  async function fetchOnboarding() {
    const res = await fetch(`${apiBase()}/api/voice-agent/onboarding`, {
      credentials: 'include'
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json : null;
  }

  /** @returns {Promise<string|null>} */
  async function resolveOnboardingRedirect() {
    const data = await fetchOnboarding();
    if (!data?.destination?.path) return null;
    const state = data.onboarding_state;
    if (isTerminalOnboardingState(state)) return null;
    if (isIncompleteOnboardingState(state)) return data.destination.path;
    return null;
  }

  /** @param {{ explicitRedirect?: string|null }} [options] */
  async function resolveProviderPostLoginUrl(_customer, options = {}) {
    const explicit = options.explicitRedirect;
    if (explicit) return explicit;

    try {
      const data = await fetchOnboarding();
      if (!data) return DEFAULT_HOME;

      const state = data.onboarding_state;
      const dest = data.destination || {};
      const blockers = Array.isArray(dest.blockers) ? dest.blockers : [];

      if (!isTerminalOnboardingState(state) && dest.path) {
        return dest.path;
      }

      if (isTerminalOnboardingState(state) && blockers.length > 0) {
        return `${DEFAULT_HOME}${GO_LIVE_HASH}`;
      }

      return DEFAULT_HOME;
    } catch (_) {
      return DEFAULT_HOME;
    }
  }

  global.SomoOnboardingRedirect = {
    DEFAULT_HOME,
    GO_LIVE_HASH,
    fetchOnboarding,
    resolveOnboardingRedirect,
    resolveProviderPostLoginUrl,
    isTerminalOnboardingState,
    isIncompleteOnboardingState
  };
})(typeof window !== 'undefined' ? window : global);
