/**
 * Checkout chat journey flags (sessionStorage per product).
 */
(function (global) {
  'use strict';

  function createJourneyState(deps) {
    const getProductId = deps.getProductId;
    const isLearnIntent = deps.isLearnIntent;
    const isCheckoutIntent = deps.isCheckoutIntent;

    function journeyStateKey() {
      return 'cc_journey_state:' + String(getProductId() || 'none');
    }

    function readJourneyState() {
      const fallback = { hasChatted: false, checkoutStarted: false, quoteReady: false };
      try {
        const raw = sessionStorage.getItem(journeyStateKey());
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return {
          hasChatted: !!(parsed && parsed.hasChatted),
          checkoutStarted: !!(parsed && parsed.checkoutStarted),
          quoteReady: !!(parsed && parsed.quoteReady)
        };
      } catch (_) {
        return fallback;
      }
    }

    let journeyState = readJourneyState();

    function persistJourneyState() {
      try {
        sessionStorage.setItem(journeyStateKey(), JSON.stringify(journeyState));
      } catch (_) {}
    }

    function markJourneyFlag(key, value) {
      if (!Object.prototype.hasOwnProperty.call(journeyState, key)) return;
      journeyState[key] = value === undefined ? true : !!value;
      persistJourneyState();
    }

    function resolveJourneyType() {
      if (isLearnIntent()) {
        return journeyState.hasChatted && !journeyState.checkoutStarted
          ? 'learn_returning_no_checkout'
          : 'learn_first_time';
      }
      if (isCheckoutIntent()) {
        return journeyState.checkoutStarted ? 'checkout_returning' : 'checkout_first_time';
      }
      return journeyState.hasChatted && !journeyState.checkoutStarted
        ? 'learn_returning_no_checkout'
        : 'learn_first_time';
    }

    function getState() {
      return journeyState;
    }

    function refreshFromStorage() {
      journeyState = readJourneyState();
      return journeyState;
    }

    return {
      journeyStateKey,
      readJourneyState,
      persistJourneyState,
      markJourneyFlag,
      resolveJourneyType,
      getState,
      refreshFromStorage
    };
  }

  global.SomoCheckoutChat = global.SomoCheckoutChat || {};
  global.SomoCheckoutChat.createJourneyState = createJourneyState;
})(typeof window !== 'undefined' ? window : global);
