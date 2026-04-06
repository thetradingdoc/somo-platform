    (function () {
      const params = new URLSearchParams(window.location.search);
      let currentProductId = params.get('product_id') || '';
      let currentMerchantId = params.get('provider_id') || '';
      const productNameHint = params.get('product_name') || '';
      const productImageHint = params.get('product_image') || params.get('image_url') || '';
      const checkoutSessionId = params.get('checkout_session_id') || '';

      const STRIP_IMAGE_FALLBACK_BY_ID = {
        'prod-vitamin-b3-serum-pore-sebum-control': '/images/products/vitamin-b3-serum.png',
        'prod-retinol-peptide-night-serum': '/images/products/retinol-brightening-night-serum.png',
        'prod-skin-hydration-serum-snail-mucin': '/images/products/dark-spot-repair-snail-mucin-serum.png',
        'prod-vitamin-c-serum-antioxidant-pro-shield': '/images/products/vitamin-c-serum.png'
      };

      const API_BASE = window.API_BASE || 'http://localhost:4000';
      const sid = localStorage.getItem('patient_session_id');

      let loadProductInFlight = null;
      const isIngredientsFocus = params.get('chat_focus') === 'ingredients';
      const isCheckoutIntent = params.get('intent') === 'checkout_chat' || params.get('cart_bootstrap') === '1';
      const isLearnIntent = isIngredientsFocus || params.get('intent') === 'learn_more';
      const phase3Param = params.get('phase3');
      let phase3Enabled = phase3Param !== '0';
      try {
        const storedFlag = localStorage.getItem('cc_phase3_enabled');
        if (storedFlag === '0') phase3Enabled = false;
        if (storedFlag === '1') phase3Enabled = true;
      } catch (_) {}
      function journeyStateKey() {
        return 'cc_journey_state:' + String(currentProductId || 'none');
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
        if (isLearnIntent) {
          return journeyState.hasChatted && !journeyState.checkoutStarted
            ? 'learn_returning_no_checkout'
            : 'learn_first_time';
        }
        if (isCheckoutIntent) {
          return journeyState.checkoutStarted ? 'checkout_returning' : 'checkout_first_time';
        }
        return journeyState.hasChatted && !journeyState.checkoutStarted
          ? 'learn_returning_no_checkout'
          : 'learn_first_time';
      }
      let journeyType = resolveJourneyType();
      let uiMode = journeyType.indexOf('checkout') === 0 ? 'checkout' : 'learn';
      if (!phase3Enabled && !isLearnIntent) uiMode = 'checkout';
      function fetchWith429Retry(url, init, options) {
        init = init || {};
        options = options || {};
        const maxAttempts = options.maxAttempts != null ? options.maxAttempts : 5;
        const baseMs = options.baseMs != null ? options.baseMs : 350;
        function sleep(ms) {
          return new Promise(function (r) { setTimeout(r, ms); });
        }
        function attempt(i) {
          return fetch(url, init).then(function (res) {
            if (res.status !== 429 || i >= maxAttempts - 1) return res;
            const ra = res.headers.get('Retry-After');
            let delayMs = ra ? parseInt(ra, 10) * 1000 : baseMs * Math.pow(2, i);
            if (!Number.isFinite(delayMs) || delayMs < 0) delayMs = baseMs * Math.pow(2, i);
            delayMs += Math.random() * 300;
            return sleep(delayMs).then(function () { return attempt(i + 1); });
          });
        }
        return attempt(0);
      }

      const elTitle = document.getElementById('productTitle');
      const elPrice = document.getElementById('productPrice');
      const elSubtitle = document.getElementById('productSubtitle');
      const elErr = document.getElementById('loadErr');
      const elErrText = document.getElementById('loadErrText');
      const elErrShop = document.getElementById('loadErrShop');
      const elErrRetry = document.getElementById('loadErrRetry');
      const btnPay = document.getElementById('btnPayStripe');
      const inlinePayConfirm = document.getElementById('ccInlinePayConfirm');
      const payEmail = document.getElementById('payEmail');
      const payErr = document.getElementById('payErr');
      const payLineItem = document.getElementById('payLineItem');
      const payTotal = document.getElementById('payTotal');
      const payCancel = document.getElementById('btnPayCancel');
      const sessionNote = document.getElementById('sessionNote');
      const btnSendChat = document.getElementById('btnSendChat');
      const chatStatus = document.getElementById('chatStatus');
      const cartItemsEl = document.getElementById('cartItems');
      const cartSubtotalEl = document.getElementById('cartSubtotal');
      const btnClearCart = document.getElementById('btnClearCart');
      const progressEl = document.getElementById('checkoutProgress');
      const ccCheckoutCartBlockEl = document.getElementById('ccCheckoutCartBlock');
      const ccCheckoutDockProgressEl = document.getElementById('ccCheckoutDockProgress');
      const guestHintEl = document.getElementById('ccGuestAppHint');
      const footerPayHintEl = document.getElementById('ccFooterPayHint');
      const learnPromptChipsEl = document.getElementById('learnPromptChips');
      const btnLearnProceed = document.getElementById('btnLearnProceed');
      const btnHeaderCart = document.getElementById('btnHeaderCart');
      const headerCartCount = document.getElementById('headerCartCount');
      /** Must be declared before `ensureKellySessionId()` / `cartSessionId` — TDZ if only below. */
      let kellySessionId = '';
      const cartSessionId = ensureKellySessionId();
      let cartState = { items: [], subtotal: 0, item_count: 0 };
      let checkoutStage = 'cart';
      var catalogLoadOk = false;
      let lastSentUserMessage = '';
      let userTurnCount = 0;
      let agenticPrimaryEmitted = false;
      let checkoutIntent = false;
      let lastQuotedAmount = null;
      let lastQuotedCurrency = 'USD';

      /** Latest Kelly `commerce_checkout` payload (used to prefer PaymentIntent flow over link fallback). */
      let commerceCheckoutFromAgent = null;
      function checkoutContractStorageKey() {
        return 'cc_contract:' + String(currentProductId || 'none');
      }
      function persistStripeContract(paymentAction, checkoutId) {
        try {
          if (!paymentAction || paymentAction.type !== 'stripe_payment_intent' || !paymentAction.client_secret) return;
          sessionStorage.setItem(checkoutContractStorageKey(), JSON.stringify({
            payment_action: paymentAction,
            checkout_id: checkoutId || null
          }));
        } catch (_) {}
      }
      function readPersistedStripeContract() {
        try {
          const raw = sessionStorage.getItem(checkoutContractStorageKey());
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (parsed && parsed.payment_action && parsed.payment_action.client_secret) return parsed;
        } catch (_) {}
        return null;
      }
      function hasMountableStripeContract() {
        try {
          const c = latestCheckoutContract || {};
          const co = c.commerce_checkout && typeof c.commerce_checkout === 'object' ? c.commerce_checkout : null;
          const pa = (co && co.payment_action) || c.payment_action || null;
          if (pa && pa.type === 'stripe_payment_intent' && pa.client_secret) return true;
          const chk = c.checkout || null;
          if (chk && (chk.client_secret || (chk.payment && chk.payment.client_secret))) return true;
          const agentPa = commerceCheckoutFromAgent && commerceCheckoutFromAgent.payment_action;
          if (agentPa && agentPa.type === 'stripe_payment_intent' && agentPa.client_secret) return true;
          return !!readPersistedStripeContract();
        } catch (_) {
          return false;
        }
      }
      let lastPreparedCheckoutId = '';
      let _ccProgSyncTimer = null;
      let stripePublishableKeyCache = null;
      let stripeClientRef = null;
      let stripeElementsRef = null;
      let stripePaymentElementRef = null;
      let stripeCardElementRef = null;
      let stripeElementMode = 'payment';
      const forceStripeCardModeForE2E = (function () {
        try {
          const qp = new URLSearchParams(window.location.search);
          if (qp.get('force_stripe_card_mode') === '1') return true;
        } catch (_) {}
        try {
          return localStorage.getItem('cc_force_stripe_card_mode') === '1';
        } catch (_) {}
        return false;
      })();
      let latestCheckoutContract = null;
      let paymentInFlight = false;
      let pendingResumeDecision = '';
      let resumeChoiceResolvedForSession = false;
      const STAGE_CTA_CONFIG = {
        collecting_details: { nudge: false, chatCta: false, placeholder: 'Ask about this product or your routine…' },
        code_sent: { nudge: false, chatCta: false, placeholder: 'Enter the 6-digit code from your email…' },
        code_verified: {
          nudge: true,
          chatCta: false,
          nudgeText: 'Email verified — continue to secure checkout.',
          nudgeAction: 'continue_secure_checkout',
          nudgeBtn: 'Continue',
          placeholder: 'Tap Continue below to proceed…'
        },
        checkout_prepared: { nudge: false, chatCta: true, placeholder: 'Payment form is ready above…' },
        payment_confirmed: {
          nudge: false,
          chatCta: false,
          placeholder: 'Questions about your order? Type below…'
        },
        failed: {
          nudge: true,
          chatCta: false,
          nudgeText: 'Payment failed. Tap to retry secure checkout.',
          nudgeAction: 'continue_secure_checkout',
          nudgeBtn: 'Retry',
          placeholder: 'Payment failed — tap Retry below…'
        }
      };

      function modeStorageKey() {
        return 'cc_ui_mode:' + String(currentProductId || 'none');
      }

      function restoreUiModePreference() {
        if (!phase3Enabled) return;
        if (isLearnIntent) {
          uiMode = 'learn';
          return;
        }
        try {
          const saved = sessionStorage.getItem(modeStorageKey());
          if (saved === 'learn' || saved === 'checkout') uiMode = saved;
        } catch (_) {}
      }

      function saveUiModePreference() {
        if (!phase3Enabled) return;
        try {
          sessionStorage.setItem(modeStorageKey(), uiMode);
        } catch (_) {}
      }

      function shouldShowLearnProceedCta() {
        if (uiMode !== 'learn') return false;
        return true;
      }

      function syncReactiveCtas() {
        if (footerPayHintEl) footerPayHintEl.classList.toggle('hidden', uiMode !== 'checkout');
        if (btnLearnProceed) btnLearnProceed.classList.toggle('hidden', !shouldShowLearnProceedCta());
        syncStarterPrompts();
      }

      function applyUiMode(mode, source) {
        const prevMode = uiMode;
        uiMode = mode === 'checkout' ? 'checkout' : 'learn';
        const checkoutActive = uiMode === 'checkout';
        document.body.classList.toggle('mode-checkout', checkoutActive);
        document.body.classList.toggle('mode-learn', !checkoutActive);
        if (ccCheckoutCartBlockEl) ccCheckoutCartBlockEl.classList.toggle('hidden', !checkoutActive);
        if (ccCheckoutDockProgressEl) ccCheckoutDockProgressEl.classList.toggle('hidden', !checkoutActive);
        if (btnHeaderCart) btnHeaderCart.classList.remove('hidden');
        var composerEyebrow = document.getElementById('composerEyebrow');
        if (composerEyebrow) {
          composerEyebrow.innerHTML = checkoutActive
            ? 'Chat with a Skin &amp; Care Assistant <span style="font-weight:500;color:var(--brand-gray);">· Checkout</span>'
            : 'Chat with a Skin &amp; Care Assistant';
        }
        setChatEmptyCopy();
        if (footerPayHintEl) {
          if (!checkoutActive) {
            footerPayHintEl.textContent = '';
          } else {
            // UX: only claim "server-locked" once cart quantity controls are actually locked.
            // (Cart controls lock when the user opens the in-chat pay modal.)
            let lockedNow = false;
            try {
              lockedNow = typeof isCartQuantityLocked === 'function' ? isCartQuantityLocked() : false;
            } catch (_) {}
            footerPayHintEl.textContent = lockedNow
              ? 'Secure checkout is locked. Your server-locked total will not change.'
              : 'Secure checkout is ready. Please confirm cart to continue.';
          }
        }
        syncReactiveCtas();
        if (!checkoutActive && inlinePayConfirm) {
          inlinePayConfirm.classList.add('hidden');
          setCheckoutStage('cart');
        }
        if (checkoutActive && product && merchantId && !quoteId && lastQuotedAmount == null) {
          fetchQuote();
        }
        saveUiModePreference();
        if (prevMode !== uiMode) {
          emitFunnelEvent('checkout_mode_changed', {
            mode: uiMode,
            previous_mode: prevMode,
            source: source || 'unknown',
            product_id: currentProductId || undefined
          });
        }
        try {
          syncCheckoutChrome();
        } catch (_) {}
      }

      function setCartCatalogDegraded(on) {
        if (!cartItemsEl || !cartSubtotalEl) return;
        if (on) {
          cartItemsEl.innerHTML =
            '<p class="cc-cart-degraded">Cart sync pauses until the catalog loads. Use <strong>Retry catalog</strong> above, then items will show here.</p>';
          cartSubtotalEl.textContent = '—';
        }
      }

      function destroyStripePaymentUi() {
        try {
          if (stripePaymentElementRef && stripePaymentElementRef.destroy) stripePaymentElementRef.destroy();
        } catch (_) {}
        stripePaymentElementRef = null;
        try {
          if (stripeCardElementRef && stripeCardElementRef.destroy) stripeCardElementRef.destroy();
        } catch (_) {}
        stripeCardElementRef = null;
        stripeElementMode = 'payment';
        try {
          if (stripeElementsRef) stripeElementsRef = null;
        } catch (_) {}
      }

      async function fetchStripePublishableKey() {
        if (stripePublishableKeyCache) return stripePublishableKeyCache;
        const res = await fetch(API_BASE + '/api/public/commerce/stripe-config', {
          headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const payload = await res.json();
        if (!res.ok || !payload || !payload.success || !payload.publishable_key) {
          throw new Error((payload && payload.error) || 'stripe_key_unavailable');
        }
        stripePublishableKeyCache = String(payload.publishable_key);
        return stripePublishableKeyCache;
      }

      async function ensureStripeClient() {
        if (stripeClientRef) return stripeClientRef;
        if (!window.Stripe) {
          throw new Error('stripe_js_not_loaded');
        }
        const pk = await fetchStripePublishableKey();
        stripeClientRef = window.Stripe(pk);
        return stripeClientRef;
      }

      async function mountStripePaymentElement(containerEl, clientSecret) {
        if (!containerEl) throw new Error('missing_stripe_mount');
        destroyStripePaymentUi();
        containerEl.innerHTML = '';
        const stripe = await ensureStripeClient();
        if (forceStripeCardModeForE2E) {
          const cardElementsForced = stripe.elements();
          stripeElementsRef = cardElementsForced;
          const cardElementForced = cardElementsForced.create('card', { hidePostalCode: false });
          stripeCardElementRef = cardElementForced;
          stripeElementMode = 'card';
          cardElementForced.mount(containerEl);
          return { stripe: stripe, elements: cardElementsForced, paymentElement: cardElementForced, mode: 'card' };
        }
        const elements = stripe.elements({ clientSecret: String(clientSecret) });
        stripeElementsRef = elements;
        const paymentElement = elements.create('payment');
        stripePaymentElementRef = paymentElement;
        paymentElement.mount(containerEl);
        await new Promise(function (resolve) {
          setTimeout(resolve, 900);
        });
        const hasInteractiveIframe = !!containerEl.querySelector('iframe');
        if (!hasInteractiveIframe) {
          try {
            paymentElement.destroy();
          } catch (_) {}
          stripePaymentElementRef = null;
          stripeElementsRef = null;
          const cardElements = stripe.elements();
          const cardElement = cardElements.create('card', { hidePostalCode: false });
          stripeCardElementRef = cardElement;
          stripeElementMode = 'card';
          cardElement.mount(containerEl);
          return { stripe: stripe, elements: cardElements, paymentElement: cardElement, mode: 'card' };
        }
        stripeElementMode = 'payment';
        return { stripe: stripe, elements: elements, paymentElement: paymentElement, mode: 'payment' };
      }

      async function pollVoiceCheckoutUntilComplete(checkoutId, opts) {
        const maxMs = (opts && opts.maxMs) || 60000;
        const started = Date.now();
        while (Date.now() - started < maxMs) {
          const res = await fetch(API_BASE + '/voice/checkout/status/' + encodeURIComponent(String(checkoutId)), {
            headers: { 'ngrok-skip-browser-warning': 'true' }
          });
          const payload = await res.json();
          if (res.ok && payload && payload.success && payload.status === 'completed') {
            return payload;
          }
          await new Promise(function (r) {
            setTimeout(r, 750);
          });
        }
        return null;
      }

      function appendReceiptBubble(opts) {
        const log = document.getElementById('chatLog');
        if (!log) return;
        const bubble = document.createElement('div');
        bubble.className = 'cc-msg cc-msg-assistant';
        bubble.setAttribute('role', 'status');
        bubble.setAttribute('aria-live', 'polite');
        const title = document.createElement('p');
        title.style.margin = '0 0 8px';
        title.innerHTML = '<strong>Receipt</strong> — payment received.';

        const lines = document.createElement('div');
        lines.style.fontSize = '0.92rem';
        lines.style.lineHeight = '1.45';
        lines.style.color = 'var(--brand-black)';

        const parts = [];
        if (opts && opts.amount != null && Number.isFinite(Number(opts.amount))) {
          parts.push('<div><strong>Total</strong>: $' + Number(opts.amount).toFixed(2) + ' USD</div>');
        }
        if (opts && opts.email) {
          parts.push('<div><strong>Receipt email</strong>: ' + String(opts.email) + '</div>');
          parts.push(
            '<div style="margin-top:6px;color:var(--brand-gray);font-size:0.85rem;">Charged securely via Stripe. If you do not see an email, check spam — delivery depends on your mail provider.</div>'
          );
        }
        if (opts && opts.billingName) {
          parts.push('<div><strong>Billing name</strong>: ' + String(opts.billingName) + '</div>');
        }
        if (opts && opts.phone) {
          parts.push('<div><strong>Phone</strong>: ' + String(opts.phone) + '</div>');
        }
        if (opts && opts.addressLine) {
          parts.push('<div><strong>Address</strong>: ' + String(opts.addressLine) + '</div>');
        }
        if (opts && opts.checkoutId) {
          parts.push('<div style="margin-top:6px;color:var(--brand-gray);font-size:0.85rem;">Order ref: ' + String(opts.checkoutId) + '</div>');
        }
        lines.innerHTML = parts.join('');
        bubble.appendChild(title);
        bubble.appendChild(lines);
        log.appendChild(bubble);
        log.scrollTop = log.scrollHeight;
        try {
          var mainEl = document.getElementById('cc-main');
          if (mainEl) mainEl.scrollTop = mainEl.scrollHeight;
        } catch (_) {}
      }

      function mergeCommerceCheckoutPayload(co) {
        if (!co || typeof co !== 'object') return;
        commerceCheckoutFromAgent = co;
        try {
          if (co.checkout_id) lastPreparedCheckoutId = String(co.checkout_id);
        } catch (_) {}
      }

      function pickPaymentActionFromSources(serverCheckout, agentCo) {
        try {
          const paAgent = agentCo && agentCo.payment_action;
          if (paAgent && (paAgent.type === 'stripe_payment_intent' || paAgent.type === 'payment_link')) return paAgent;
        } catch (_) {}
        try {
          const cs =
            serverCheckout &&
            (serverCheckout.client_secret || (serverCheckout.payment && serverCheckout.payment.client_secret));
          const pi =
            serverCheckout &&
            (serverCheckout.payment_intent_id || (serverCheckout.payment && serverCheckout.payment.payment_intent_id));
          if (cs && pi) {
            return { type: 'stripe_payment_intent', client_secret: cs, payment_intent_id: pi };
          }
          const link = serverCheckout && serverCheckout.payment_link;
          if (link) return { type: 'payment_link', url: link };
        } catch (_) {}
        return null;
      }

      function lockPaymentBubbleAfterSuccess() {
        try {
          destroyStripePaymentUi();
        } catch (_) {}
        try {
          var inline = document.getElementById('ccInlinePayConfirm');
          if (inline) inline.classList.add('hidden');
        } catch (_) {}
        var mount = document.getElementById('ccStripePaymentMount');
        if (!mount) return;
        var bubble = mount.closest('.cc-msg');
        if (!bubble) return;
        bubble.classList.add('cc-payment-bubble--locked');
        bubble.innerHTML =
          '<p style="margin:0 0 8px;"><strong>Payment complete</strong></p>' +
          '<p style="margin:0;font-size:0.88rem;color:var(--brand-gray);line-height:1.45;">' +
          'Billing and card fields are closed and removed from this page for your security. See your receipt below.</p>';
      }

      async function finalizeSuccessfulInChatCheckout(ctx) {
        const checkoutId = ctx && ctx.checkout_id;
        const email = ctx && ctx.email;
        const billingName = ctx && ctx.billing_name;
        const phone = ctx && ctx.phone;
        const addressLine = ctx && ctx.address_line;
        let amount = ctx && ctx.amount;
        try {
          if (checkoutId) {
            const st = await pollVoiceCheckoutUntilComplete(checkoutId, { maxMs: 60000 });
            if (st && st.amount != null) amount = st.amount;
          }
        } catch (_) {}

        try {
          lockPaymentBubbleAfterSuccess();
        } catch (_) {}

        try {
          await postCart('/api/public/commerce/cart/clear', {});
          cartState = { items: [], subtotal: 0, item_count: 0 };
          renderCart();
        } catch (_) {}

        showPostPurchaseBridge();

        appendReceiptBubble({
          checkoutId: checkoutId,
          email: email,
          billingName: billingName,
          phone: phone,
          addressLine: addressLine,
          amount: amount
        });
        emitFunnelEvent('pay_success', { product_id: product && product.id, quote_id: quoteId || undefined });
      }

      function showPostPurchaseBridge() {
        clearCheckoutFlowStage();
        setCheckoutStage('confirm');
      }

      function applyCommerceCheckoutFromPayload(co) {
        if (!co) return;
        mergeCommerceCheckoutPayload(co.commerce_checkout ? co.commerce_checkout : co);
        refreshCart().catch(function () {});
        var pa = (co.commerce_checkout && co.commerce_checkout.payment_action) || co.payment_action;
        if (pa && (pa.type === 'stripe_payment_intent' || pa.type === 'payment_link')) {
          // Keep the stepper on shipping until the user passes verification in the payment widget.
          if (checkoutStage === 'payment' || checkoutStage === 'confirm') {
            setCheckoutStage(checkoutStage);
          } else {
            setCheckoutStage('shipping');
          }
        }
      }

      function checkoutFlowStorageKey() {
        return 'cc_checkout_flow:' + String(currentProductId || 'none');
      }

      function scheduleSyncCheckoutProgress() {
        if (!cartSessionId || !merchantId || !API_BASE) return;
        clearTimeout(_ccProgSyncTimer);
        _ccProgSyncTimer = setTimeout(function () {
          fetch(API_BASE + '/api/public/commerce/checkout-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({
              session_id: cartSessionId,
              provider_id: merchantId,
              stage: checkoutStage,
              quote_id: quoteId || '',
              checkout_id: lastPreparedCheckoutId || '',
              checkout_intent: !!checkoutIntent,
              product_id: currentProductId || ''
            })
          }).catch(function () {});
        }, 400);
      }

      function persistCheckoutFlowStage() {
        try {
          sessionStorage.setItem(
            checkoutFlowStorageKey(),
            JSON.stringify({
              stage: checkoutStage,
              product_id: currentProductId,
              ui_mode: uiMode,
              quote_id: quoteId || '',
              checkout_intent: !!checkoutIntent,
              ts: Date.now()
            })
          );
        } catch (_) {}
        scheduleSyncCheckoutProgress();
      }

      async function mergeCheckoutProgressFromServer() {
        if (!cartSessionId || !merchantId || !API_BASE) return;
        try {
          const res = await fetch(
            API_BASE +
              '/api/public/commerce/checkout-progress?session_id=' +
              encodeURIComponent(cartSessionId) +
              '&provider_id=' +
              encodeURIComponent(merchantId),
            { headers: { 'ngrok-skip-browser-warning': 'true' } }
          );
          const data = await res.json();
          const p = data && data.progress;
          if (!p || !p.updated_at) return;
          var localTs = 0;
          try {
            var localRaw = sessionStorage.getItem(checkoutFlowStorageKey());
            if (localRaw) {
              var o = JSON.parse(localRaw);
              localTs = o.ts || 0;
            }
          } catch (_) {}
          var serverTs = Date.parse(p.updated_at);
          if (!Number.isFinite(serverTs) || serverTs <= localTs) return;
          if (p.product_id && String(p.product_id) !== String(currentProductId)) return;
          if (p.quote_id) quoteId = String(p.quote_id);
          if (typeof p.checkout_intent === 'boolean') checkoutIntent = p.checkout_intent;
          if (p.checkout_id) lastPreparedCheckoutId = String(p.checkout_id);
          var order = ['cart', 'shipping', 'payment', 'confirm'];
          if (p.stage && order.indexOf(String(p.stage)) >= 0) {
            setCheckoutStage(String(p.stage));
          } else {
            persistCheckoutFlowStage();
          }
        } catch (_) {}
      }

      function clearCheckoutFlowStage() {
        try {
          sessionStorage.removeItem(checkoutFlowStorageKey());
        } catch (_) {}
      }

      /**
       * Restores stepper stage + quote id + checkout intent from sessionStorage (same tab).
       * Returns a small object if something was restored so init can avoid resetting the stepper.
       */
      function restoreCheckoutFlowStage() {
        try {
          const raw = sessionStorage.getItem(checkoutFlowStorageKey());
          if (!raw) return null;
          const o = JSON.parse(raw);
          if (o.product_id != null && String(o.product_id) !== String(currentProductId)) return null;
          if (o.stage === 'delivery') o.stage = 'confirm';
          const order = ['cart', 'shipping', 'payment', 'confirm'];
          if (o.quote_id) quoteId = String(o.quote_id);
          if (typeof o.checkout_intent === 'boolean') checkoutIntent = o.checkout_intent;
          if (o.stage && order.indexOf(String(o.stage)) >= 0) {
            setCheckoutStage(String(o.stage));
          }
          return { stage: o.stage, quote_id: o.quote_id, checkout_intent: o.checkout_intent };
        } catch (_) {
          return null;
        }
      }

      function setCheckoutStage(stage) {
        checkoutStage = stage || 'cart';
        if (!progressEl) return;
        const order = ['cart', 'shipping', 'payment', 'confirm'];
        const idx = order.indexOf(checkoutStage);
        progressEl.querySelectorAll('.cc-step').forEach((node) => {
          const step = node.getAttribute('data-step');
          const i = order.indexOf(step);
          if (i < 0) {
            node.classList.add('hidden');
            return;
          }
          node.classList.remove('hidden');
          node.classList.toggle('is-active', i === idx);
          node.classList.toggle('is-done', i > -1 && i < idx);
          const shouldShow = i > -1 && i <= idx + 1;
          node.classList.toggle('is-hidden', !shouldShow);
        });
        persistCheckoutFlowStage();
        try {
          syncCheckoutChrome();
        } catch (_) {}
      }

      function applyStageContract(donePayload) {
        if (!donePayload) return;
        latestCheckoutContract = donePayload;
        try {
          const co = donePayload.commerce_checkout && typeof donePayload.commerce_checkout === 'object'
            ? donePayload.commerce_checkout
            : null;
          const pa = (co && co.payment_action) || donePayload.payment_action || null;
          const chk = donePayload.checkout || null;
          const checkoutId = (co && co.checkout_id) || (chk && chk.checkout_id) || null;
          if (pa && pa.type === 'stripe_payment_intent' && pa.client_secret) {
            persistStripeContract(pa, checkoutId);
          } else if (chk) {
            const cs = chk.client_secret || (chk.payment && chk.payment.client_secret) || '';
            const pi = chk.payment_intent_id || (chk.payment && chk.payment.payment_intent_id) || '';
            if (cs && pi) {
              persistStripeContract({ type: 'stripe_payment_intent', client_secret: cs, payment_intent_id: pi }, checkoutId);
            }
          }
        } catch (_) {}
        var stage = String(donePayload.checkout_stage || '');
        if (!stage) return;
        var stageToStep = {
          collecting_details: 'cart',
          code_sent: 'shipping',
          code_verified: 'shipping',
          checkout_prepared: 'payment',
          payment_confirmed: 'confirm',
          failed: 'payment'
        };
        if (stageToStep[stage]) setCheckoutStage(stageToStep[stage]);
        _applyStageCta(stage);

        var composerEl = document.getElementById('composer');
        var cfg = STAGE_CTA_CONFIG[stage];
        if (composerEl && cfg && cfg.placeholder) {
          composerEl.setAttribute('placeholder', cfg.placeholder);
        }
        if (stage === 'payment_confirmed' && composerEl) {
          try {
            composerEl.value = '';
          } catch (_) {}
          try {
            lockPaymentBubbleAfterSuccess();
          } catch (_) {}
        }
        if (stage === 'checkout_prepared') {
          // Recovery hook: if prepared but CTA is missing due to stale UI, re-render deterministically.
          setTimeout(function () { ensurePreparedPaymentSurface(); }, 250);
          setTimeout(function () { ensurePreparedPaymentSurface(); }, 1200);
        }
      }

      function _applyStageCta(stage) {
        var cfg = STAGE_CTA_CONFIG[stage];
        if (!cfg) return;
        var strip = document.getElementById('turnNudge');
        // Popup nudge is intentionally disabled; checkout guidance stays in chat only.
        if (strip) strip.classList.remove('is-visible');
        if (cfg.chatCta && canOpenPaymentPanel()) {
          renderPayCTAInChat();
          return;
        }
        removePayCTAInChat();
      }

      function renderCart() {
        if (!cartItemsEl || !cartSubtotalEl) return;
        const items = Array.isArray(cartState.items) ? cartState.items : [];
        if (!items.length) {
          cartItemsEl.innerHTML = '<p class="cc-cart-empty">Your cart is empty. Ask Kelly to add an item.</p>';
          cartSubtotalEl.textContent = '$0.00';
          if (headerCartCount) headerCartCount.textContent = '0';
          syncReactiveCtas();
          return;
        }
        const qtyLocked = isCartQuantityLocked();
        cartItemsEl.innerHTML = items.map((it) => {
          const actions = qtyLocked
            ? '<div class="cc-cart-actions cc-cart-actions--locked" aria-label="Quantity locked for checkout">' +
              '<span class="cc-cart-lock-badge">Locked</span>' +
              '</div>'
            : '<div class="cc-cart-actions">' +
              '<button type="button" data-action="dec">−</button><button type="button" data-action="inc">+</button><button type="button" data-action="remove">×</button>' +
              '</div>';
          return (
            '<div class="cc-cart-item" data-product-id="' + String(it.product_id || '') + '">' +
            '<div><strong>' + String(it.name || it.product_id || 'Item') + '</strong><p>$' + Number(it.total || 0).toFixed(2) + ' · Qty ' + Number(it.quantity || 0) + '</p></div>' +
            actions +
            '</div>'
          );
        }).join('');
        cartSubtotalEl.textContent = '$' + Number(cartState.subtotal || 0).toFixed(2);
        if (headerCartCount) headerCartCount.textContent = String(Number(cartState.item_count || 0));
        if (btnHeaderCart) {
          const count = Number(cartState.item_count || 0);
          btnHeaderCart.setAttribute(
            'aria-label',
            'Open cart and checkout, ' + String(count) + ' item' + (count === 1 ? '' : 's')
          );
        }
        syncReactiveCtas();
        syncCheckoutChrome();
      }

      async function postCart(path, body) {
        const res = await fetch(API_BASE + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
          body: JSON.stringify({ session_id: cartSessionId, provider_id: merchantId || undefined, ...(body || {}) })
        });
        const payload = await res.json().catch(function () { return {}; });
        if (!res.ok || payload.success === false) {
          const err = new Error(payload.error || payload.message || 'cart_request_failed');
          err.code = String(payload.error || '');
          err.status = Number(res.status || 0);
          throw err;
        }
        return payload;
      }

      function normalizeKellyCheckoutReply(text) {
        var s = String(text || '').trim();
        if (!s) return s;
        // Guardrail: never promise card form before email verification succeeds.
        s = s.replace(
          /a secure payment form will appear above where you can enter your card details to complete the purchase\.?/gi,
          'I sent a 6-digit verification code to your email. Please enter it to continue to secure payment.'
        );
        s = s.replace(
          /a secure payment form will appear above[^.]*\./gi,
          'I sent a 6-digit verification code to your email. Please enter it to continue to secure payment.'
        );
        s = s.replace(
          /your secure payment form should appear now\.?/gi,
          'I sent a 6-digit verification code to your email. Please enter it to continue to secure payment.'
        );
        s = s.replace(
          /next step:\s*you'?ll now be taken to our secure payment page to complete your purchase\.?/gi,
          'Next step: I sent a 6-digit verification code to your email. Please enter it to continue to secure payment.'
        );
        var looksLikeCheckoutHandoff =
          /(order summary|order is ready|secure payment page|taken to .*secure payment|complete your purchase|enter your card details)/i.test(s);
        var mentionsVerification = /(verification code|6-?digit code|verify your email)/i.test(s);
        if (looksLikeCheckoutHandoff && !mentionsVerification) {
          s += ' Before payment, please enter the 6-digit verification code we emailed you.';
        }
        if (/order confirmation will be sent to/i.test(s) && !/verification code/i.test(s)) {
          s += ' Please enter the 6-digit verification code from your email to continue.';
        }
        return s;
      }

      async function bootstrapCartWithCurrentProduct() {
        if (!catalogLoadOk || !currentProductId || !merchantId) return;
        try {
          await postCart('/api/public/commerce/cart/add', { product_id: currentProductId, quantity: 1 });
          await refreshCart();
        } catch (_) {}
      }

      async function refreshCart() {
        const q = new URLSearchParams({
          session_id: cartSessionId,
          provider_id: merchantId || ''
        });
        q.set('_ts', String(Date.now()));
        const res = await fetch(API_BASE + '/api/public/commerce/cart?' + q.toString(), {
          cache: 'no-store',
          headers: {
            'ngrok-skip-browser-warning': 'true',
            'Cache-Control': 'no-cache'
          }
        });
        const payload = await res.json();
        if (res.ok && payload.success) {
          cartState = payload.cart || { items: [], subtotal: 0, item_count: 0 };
        } else {
          cartState = { items: [], subtotal: 0, item_count: 0 };
        }
        renderCart();
        ensurePreparedPaymentSurface();
      }

      /** Canonical copy: `../copy/checkout-kelly.json` — keep in sync if keys change. Use ASCII quotes only (no curly apostrophes) inside this script. */
      const DEFAULT_KELLY_COPY = {
        voiceNotes:
          'Warm, confident, non-clinical — Skin & Care specialist voice, not a doctor. Short by default.',
        sysFirstTimeHtml:
          '<strong>Skin &amp; Care</strong> — your guide can answer questions about this product, ingredients, and your routine. Your total is always <strong>server-locked</strong> at checkout (no surprise prices). Start with chat below; when you are ready, use <em>Pay securely</em> in the thread, or the optional shortcut at the bottom.',
        sysReturningHtml:
          '<strong>Welcome back.</strong> Continue with your Skin &amp; Care guide, or use the shortcut below — your total stays server-locked.',
        composerEyebrowHtml: 'Chat with a Skin &amp; Care Assistant',
        footerPayHint: 'Optional: same secure, server-locked total if you prefer to skip chat.',
        placeholderFirstTime: 'Ask about this product or your routine…',
        placeholderReturning: 'Ask about this product or your routine…',
        sessionNoteCheckout: 'Picking up where you left off — prices stay server-locked.',
        softNudges: [
          'If you are ready, I can line this up for you.',
          'Want your server-locked total in one step?'
        ],
        statusThinking: 'Your guide is preparing a reply…',
        statusTypeFirst: 'Type a message first.',
        statusProductLoading: 'Hang on — product details are still loading.',
        statusSignIn: 'Please sign in again.',
        productSwitchAssistant: 'Switched — ask anything about this pick, or continue when you\'re ready.',
        fallbackReply: 'I\'m here — what would you like to know?',
        errorConnectionAssistant:
          'We could not reach the server just now. Try again shortly, or use the pay shortcut below when it is available.',
        checkoutCta: 'Continue to secure checkout',
        payWithoutChat: 'Pay without chat',
        modalConfirmTitle: 'Confirm payment',
        inlinePayKellyLead:
          'Kelly — when you are ready, confirm payment below. You can keep chatting while you finish checkout.',
        payTrustLine: 'Stripe · Encrypted checkout',
        payRedirectNote: 'You\'ll complete card entry on our secure page.',
        payHeroAria: 'Pay securely with Stripe',
        backToShop: 'Back to shop',
        chatEmptyHint:
          'Ask your Skin & Care guide about this product, build your cart in chat, then checkout when you are ready.',
        chatEmptyTitleCheckout: 'Confirm product',
        chatEmptyBodyCheckout:
          'Does this look like the right product and quantity in your cart? Reply here to confirm, or tell me what you would like to change before we continue.',
        cartBootstrapAssistant:
          'Confirm product — I added this to your cart. Does this look right? Reply yes to continue, or tell me what to change.',
        placeholderCheckout: 'Reply to confirm or ask a question…',
        modalTitle: 'Secure checkout',
        payWithStripe: 'Pay with Stripe',
        cancel: 'Cancel',
        backToProducts: 'Back to products',
        emailRequired: 'Add your email for the receipt.',
        sendToKelly: 'Send',
        pickerLabel: 'Choose product',
        chipReadyCheckout: 'Ready to check out?',
        nudgeAfterTurns:
          'Still browsing? Your Skin & Care total stays server-locked — tap Continue when you\'re ready.',
        priceUpdating: 'Updating price…',
        typingIndicator: 'Your guide is preparing…',
        chipCheckoutCta: 'Continue',
        cartLockHint:
          'Quantity controls are locked for your quoted checkout total. Ask Kelly to change your cart before you pay.',
        securePayExplain:
          'You complete payment here with Stripe (encrypted). We do not email a separate pay link for in-chat card checkout. Your receipt is sent to the email you enter. Card data is handled by Stripe under PCI standards; we do not store your full card number.',
        payRedirectNote:
          'Card entry happens here via Stripe. If you ever use an email-only backup link, check spam — links can expire (often within about a day).',
        exitCheckoutLabel: 'Exit checkout',
        bridgeMessage: 'Taking you to your Skin & Care guide…',
        switchConfirmLead: 'Switch to ',
        skipSwitchConfirmLabel: 'Don\'t ask again this session',
        whyPriceSummary: 'Why this price?',
        whyPriceBody:
          'Your total is server-locked at checkout — the number Kelly quotes matches what you pay through Stripe.'
      };

      let KELLY_COPY = DEFAULT_KELLY_COPY;

      (function runBridgeHandoff() {
        try {
          if (params.get('bridge') === '1') {
            const overlay = document.getElementById('ccBridgeOverlay');
            if (overlay) {
              overlay.classList.add('is-visible');
              overlay.setAttribute('aria-hidden', 'false');
              window.setTimeout(function () {
                overlay.classList.remove('is-visible');
                overlay.setAttribute('aria-hidden', 'true');
                const u = new URL(window.location.href);
                u.searchParams.delete('bridge');
                window.history.replaceState({}, '', u.toString());
              }, 900);
            }
          }
        } catch (_) {}
      })();

      function kellyCopy(key) {
        const v = KELLY_COPY && KELLY_COPY[key];
        return v != null && v !== '' ? v : DEFAULT_KELLY_COPY[key];
      }

      function setChatEmptyCopy() {
        const titleEl = document.getElementById('chatEmptyTitle');
        const bodyEl = document.getElementById('chatEmptyBody');
        if (!bodyEl) return;
        if (uiMode === 'checkout') {
          if (titleEl) {
            titleEl.textContent = kellyCopy('chatEmptyTitleCheckout') || 'Confirm product';
            titleEl.classList.remove('hidden');
            titleEl.setAttribute('aria-hidden', 'false');
          }
          bodyEl.textContent =
            kellyCopy('chatEmptyBodyCheckout') ||
            'Reply here to confirm, or tell me what you would like to change.';
        } else {
          if (titleEl) {
            titleEl.textContent = '';
            titleEl.classList.add('hidden');
            titleEl.setAttribute('aria-hidden', 'true');
          }
          bodyEl.textContent =
            kellyCopy('chatEmptyHint') ||
            'Ask your Skin & Care guide about this product, then checkout when you are ready.';
        }
        const composerEl = document.getElementById('composer');
        if (composerEl) {
          if (uiMode === 'checkout') {
            composerEl.setAttribute(
              'placeholder',
              kellyCopy('placeholderCheckout') || 'Reply to confirm or ask a question…'
            );
          } else {
            const returning = journeyIsReturningLearn() || journeyType === 'checkout_returning';
            composerEl.setAttribute(
              'placeholder',
              journeyIsLearn()
                ? kellyCopy('placeholderFirstTime') || ''
                : returning
                  ? kellyCopy('placeholderReturning') || ''
                  : kellyCopy('placeholderFirstTime') || ''
            );
          }
        }
      }
      function journeyIsReturningLearn() {
        return journeyType === 'learn_returning_no_checkout';
      }

      function journeyIsLearn() {
        return journeyType.indexOf('learn_') === 0;
      }

      function journeySystemMessage(copy) {
        if (journeyType === 'learn_first_time') {
          return '<strong>Hi there.</strong> I am glad you are here. I can explain what this product does, who it is best for, and how to use it in your routine. What would you like to know first?';
        }
        if (journeyType === 'learn_returning_no_checkout') {
          return '<strong>Welcome back.</strong> Happy to keep helping with this product. What would you like to know next?';
        }
        return copy.sysReturningHtml || copy.sysFirstTimeHtml;
      }

      function normalizeInlineMarkdownToHtml(s) {
        return String(s || '').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      }

      function applyKellyCopy(copy) {
        const sysMsgEl = document.getElementById('sysMsg');
        const composerEl = document.getElementById('composer');
        const returning = journeyIsReturningLearn() || journeyType === 'checkout_returning';
        if (sysMsgEl) {
          sysMsgEl.innerHTML = normalizeInlineMarkdownToHtml(journeySystemMessage(copy));
        }
        if (composerEl) {
          composerEl.setAttribute(
            'placeholder',
            journeyIsLearn()
              ? (copy.placeholderFirstTime || copy.placeholderReturning)
              : (returning ? copy.placeholderReturning : copy.placeholderFirstTime)
          );
        }
        const pl = document.getElementById('productPickerLabel');
        if (pl && copy.pickerLabel) pl.textContent = copy.pickerLabel;
        const sendLbl = document.getElementById('btnSendChatLabel');
        if (sendLbl && copy.sendToKelly) sendLbl.textContent = copy.sendToKelly;
        const sendFab = document.getElementById('btnSendChat');
        if (sendFab && copy.sendToKelly) sendFab.setAttribute('aria-label', copy.sendToKelly);
        const sheetTitleEl = document.getElementById('sheetTitle');
        if (sheetTitleEl && copy.pickerLabel) sheetTitleEl.textContent = copy.pickerLabel;
        const payTitleText = document.getElementById('payTitleText');
        if (payTitleText && copy.modalConfirmTitle) payTitleText.textContent = copy.modalConfirmTitle;
        const inlineKelly = document.getElementById('ccInlinePayKellyLead');
        if (inlineKelly && copy.inlinePayKellyLead) inlineKelly.textContent = copy.inlinePayKellyLead;
        const payTrustEl = document.getElementById('payTrustText');
        if (payTrustEl && copy.payTrustLine) payTrustEl.textContent = copy.payTrustLine;
        const payRedirEl = document.getElementById('payRedirectNote');
        if (payRedirEl && copy.payRedirectNote) payRedirEl.textContent = copy.payRedirectNote;
        const bts = document.getElementById('backToShop');
        if (bts && copy.backToShop) bts.textContent = copy.backToShop;
        if (bts && typeof window.LANDING_BASE === 'string' && window.LANDING_BASE) {
          bts.href = window.LANDING_BASE;
        }
        const brandHome = document.getElementById('ccBrandHome');
        if (brandHome && typeof window.LANDING_BASE === 'string' && window.LANDING_BASE) {
          brandHome.href = window.LANDING_BASE;
        }
        const composerEyebrow = document.getElementById('composerEyebrow');
        if (composerEyebrow && copy.composerEyebrowHtml) {
          composerEyebrow.innerHTML = copy.composerEyebrowHtml;
        }
        const footerPayHint = document.getElementById('ccFooterPayHint');
        if (footerPayHint && copy.footerPayHint) {
          footerPayHint.textContent = copy.footerPayHint;
        }
        const payStripeLbl = document.getElementById('btnPayStripeLabel');
        if (payStripeLbl && copy.payWithStripe) payStripeLbl.textContent = copy.payWithStripe;
        const payStripeBtn = document.getElementById('btnPayStripe');
        if (payStripeBtn && copy.payWithStripe) payStripeBtn.setAttribute('aria-label', copy.payWithStripe);
        const payCancelLbl = document.getElementById('btnPayCancelLabel');
        if (payCancelLbl && copy.cancel) payCancelLbl.textContent = copy.cancel;
        // Chat-only checkout UX: popup nudge copy is intentionally unused.
        const bridgeEl = document.getElementById('ccBridgeCopy');
        if (bridgeEl && copy.bridgeMessage) bridgeEl.textContent = copy.bridgeMessage;
        const skipSwitchLbl = document.getElementById('chkSkipSwitchConfirmLabel');
        if (skipSwitchLbl && copy.skipSwitchConfirmLabel) {
          skipSwitchLbl.textContent = copy.skipSwitchConfirmLabel;
        }
        const errShopA = document.getElementById('loadErrShop');
        if (errShopA && copy.backToShop) errShopA.textContent = copy.backToShop;
        if (errShopA && typeof window.LANDING_BASE === 'string' && window.LANDING_BASE) {
          errShopA.href = window.LANDING_BASE;
        }
        const whySum = document.getElementById('whyPriceSummary');
        const whyBody = document.getElementById('whyPriceBody');
        if (whySum && copy.whyPriceSummary) whySum.textContent = copy.whyPriceSummary;
        if (whyBody && copy.whyPriceBody) whyBody.textContent = copy.whyPriceBody;
        try {
          updateChatEmptyState();
        } catch (_) {}
        try {
          applyUiMode(uiMode);
        } catch (_) {}
      }

      (async function refreshKellyCopyFromFile() {
        try {
          const url = new URL('../copy/checkout-kelly.json', window.location.href).href;
          const r = await fetch(url, { cache: 'no-store' });
          if (r.ok) {
            const j = await r.json();
            KELLY_COPY = Object.assign({}, DEFAULT_KELLY_COPY, j);
            applyKellyCopy(KELLY_COPY);
          }
        } catch (_) {}
      })();

      let product = null;
      let merchantId = currentMerchantId || '';
      let quoteId = '';
      let catalogProducts = [];

      applyKellyCopy(KELLY_COPY);

      restoreUiModePreference();

      function isCartQuantityLocked() {
        if (uiMode !== 'checkout') return false;
        if (!checkoutIntent) return false;
        // Some flows (cart-first) may not have `quoteId` immediately, but once the
        // server has prepared a checkout we should still lock quantities.
        return Boolean(quoteId || lastPreparedCheckoutId);
      }

      function syncCheckoutChrome() {
        const lockEl = document.getElementById('ccCartLockHint');
        const secEl = document.getElementById('ccSecurePayExplain');
        if (lockEl) {
          if (isCartQuantityLocked()) {
            lockEl.textContent = kellyCopy('cartLockHint') || '';
            lockEl.classList.remove('hidden');
          } else {
            lockEl.classList.add('hidden');
            lockEl.textContent = '';
          }
        }
        if (secEl) {
          if (uiMode === 'checkout' && checkoutIntent) {
            secEl.textContent = kellyCopy('securePayExplain') || '';
            secEl.classList.remove('hidden');
          } else {
            secEl.classList.add('hidden');
            secEl.textContent = '';
          }
        }
      }

      function exitCheckoutFlow() {
        destroyStripePaymentUi();
        removePayCTAInChat();
        const payBubble = document.getElementById('ccPayConfirmChatBubble');
        if (payBubble && payBubble.parentNode) payBubble.parentNode.removeChild(payBubble);
        checkoutIntent = false;
        markJourneyFlag('checkoutStarted', false);
        quoteId = '';
        lastQuotedAmount = null;
        markJourneyFlag('quoteReady', false);
        clearCheckoutFlowStage();
        setCheckoutStage('cart');
        journeyType = resolveJourneyType();
        applyUiMode('learn', 'exit_checkout');
        if (elPrice && product && Number.isFinite(Number(product.price))) {
          elPrice.textContent = '$' + Number(product.price).toFixed(2);
        }
        void refreshCart();
        updateInThreadPayUI();
        emitFunnelEvent('checkout_mode_changed', { mode: 'learn', source: 'exit_checkout', product_id: currentProductId });
        syncCheckoutChrome();
      }

      function updateInThreadPayUI() {
        // Disable the top/in-thread pay control so payment CTAs only appear in the chat flow.
        var wrap = document.getElementById('inThreadPayWrap');
        var btn = document.getElementById('btnPayInThread');
        var orderCard = document.getElementById('orderSummaryCard');
        if (orderCard) orderCard.classList.add('hidden');
        if (wrap) wrap.classList.add('hidden');
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Pay securely';
        }

        // Keep other CTA visibility in sync.
        syncReactiveCtas();

        if (uiMode !== 'checkout' || !checkoutIntent) {
          removePayCTAInChat();
          return;
        }

        renderPayCTAInChat();
        syncCheckoutChrome();
      }

      function removePayCTAInChat() {
        const old = document.getElementById('ccPayCTAChatBubble');
        if (old && old.parentNode) old.parentNode.removeChild(old);
      }

      function canOpenPaymentPanel() {
        const c = latestCheckoutContract || {};
        const flags = c.policy_flags || {};
        const actions = Array.isArray(c.allowed_next_actions) ? c.allowed_next_actions : [];
        const stage = String(c.checkout_stage || '');
        const explicitlyPrepared = Boolean(flags.can_show_payment_form || actions.indexOf('complete_payment_form') >= 0 || stage === 'checkout_prepared');
        if (!explicitlyPrepared) return false;
        return true;
      }

      function ensurePreparedPaymentSurface() {
        if (uiMode !== 'checkout') return;
        const c = latestCheckoutContract || {};
        const stage = String(c.checkout_stage || '');
        const actions = Array.isArray(c.allowed_next_actions) ? c.allowed_next_actions : [];
        const prepared = stage === 'checkout_prepared' || actions.indexOf('complete_payment_form') >= 0;
        if (!prepared) return;
        checkoutIntent = true;
        const hasModal = !!document.getElementById('ccPayConfirmChatBubble');
        const hasCta = !!document.getElementById('ccPayCTAChatBubble');
        if (!hasModal && !hasCta) renderPayCTAInChat();
      }

      async function syncCheckoutContractFromServer() {
        try {
          if (uiMode !== 'checkout' && !pendingResumeDecision) return;
          const sessionId = ensureKellySessionId();
          if (!sessionId) return;
          const q = new URLSearchParams({
            session_id: sessionId,
            ui_mode: String(uiMode || ''),
            checkout_intent: uiMode === 'checkout' ? '1' : (checkoutIntent ? '1' : '0'),
            product_id: String(currentProductId || '')
          });
          const decision = String(pendingResumeDecision || '').trim();
          if (decision) q.set('resume_decision', decision);
          const res = await fetch(API_BASE + '/api/public/checkout-chat/stage?' + q.toString(), {
            cache: 'no-store',
            headers: {
              'ngrok-skip-browser-warning': 'true',
              'Cache-Control': 'no-cache'
            }
          });
          const payload = await res.json().catch(function () { return {}; });
          if (!res.ok || !payload || payload.success === false) return;
          if (decision) pendingResumeDecision = '';
          applyStageContract(payload);
          if (payload.commerce_checkout) {
            latestCheckoutContract = Object.assign({}, latestCheckoutContract || {}, {
              commerce_checkout: payload.commerce_checkout
            });
            try {
              const pa = payload.commerce_checkout.payment_action || null;
              if (pa && pa.type === 'stripe_payment_intent' && pa.client_secret) {
                persistStripeContract(pa, payload.commerce_checkout.checkout_id || null);
              }
            } catch (_) {}
          }
          ensurePreparedPaymentSurface();
        } catch (_) {}
      }

      async function maybePromptResumeDecisionOnEntry() {
        try {
          if (resumeChoiceResolvedForSession) return;
          const sessionId = ensureKellySessionId();
          if (!sessionId) return;
          const q = new URLSearchParams({
            session_id: sessionId,
            ui_mode: String(uiMode || ''),
            checkout_intent: uiMode === 'checkout' ? '1' : (checkoutIntent ? '1' : '0'),
            product_id: String(currentProductId || '')
          });
          const res = await fetch(API_BASE + '/api/public/checkout-chat/stage?' + q.toString(), {
            cache: 'no-store',
            headers: {
              'ngrok-skip-browser-warning': 'true',
              'Cache-Control': 'no-cache'
            }
          });
          const payload = await res.json().catch(function () { return {}; });
          if (!res.ok || !payload || payload.success === false) return;
          const stage = String(payload.checkout_stage || '').trim();
          const resumable = ['code_sent', 'code_verified', 'checkout_prepared', 'failed'].indexOf(stage) >= 0;
          if (!resumable) {
            resumeChoiceResolvedForSession = true;
            return;
          }
          // If checkout intent is explicit (deep-link or prior user action),
          // avoid a blocking resume prompt and continue deterministically.
          if (uiMode === 'checkout' && checkoutIntent) {
            pendingResumeDecision = 'continue';
            resumeChoiceResolvedForSession = true;
            applyUiMode('checkout', 'intent_auto_continue');
            renderResumeBanner(Date.now());
            return;
          }
          const resume = window.confirm(
            kellyCopy('resumePromptBody') ||
              'A previous checkout was found. Press OK to continue previous checkout, or Cancel to start over.'
          );
          pendingResumeDecision = resume ? 'continue' : 'start_over';
          resumeChoiceResolvedForSession = true;
          if (resume) {
            checkoutIntent = true;
            markJourneyFlag('checkoutStarted', true);
            journeyType = 'checkout_returning';
            applyUiMode('checkout', 'resume_continue');
            renderResumeBanner(Date.now());
          } else {
            latestCheckoutContract = null;
            checkoutIntent = false;
            removePayCTAInChat();
            setCheckoutStage('cart');
          }
        } catch (_) {}
      }

      function renderPayCTAInChat() {
        if (!canOpenPaymentPanel()) return;
        const log = document.getElementById('chatLog');
        if (!log) return;

        const cartCount = Number((cartState && cartState.item_count) || 0);
        const stage = String((latestCheckoutContract && latestCheckoutContract.checkout_stage) || '');
        const preparedByContract = stage === 'checkout_prepared';
        const displayAmt =
          cartState && Number.isFinite(Number(cartState.subtotal))
            ? Number(cartState.subtotal)
            : (lastQuotedAmount != null && Number.isFinite(Number(lastQuotedAmount))
              ? Number(lastQuotedAmount)
              : (product && Number.isFinite(Number(product.price)) ? Number(product.price) : null));

        // UX fix: in some cart-first flows `quoteId` arrives late (or not at all),
        // but we can still let the user proceed using the known amount.
        // Note: do NOT gate on `checkoutIntent` here; the click handler is what
        // enables checkoutIntent (and starts Stripe confirmation).
        const ready = canOpenPaymentPanel();

        // Replace existing bubble to avoid duplicates.
        removePayCTAInChat();

        const bubble = document.createElement('div');
        bubble.id = 'ccPayCTAChatBubble';
        bubble.className = 'cc-msg cc-msg-assistant';
        bubble.setAttribute('role', 'group');
        bubble.setAttribute('aria-label', 'Pay securely');

        const lead = document.createElement('p');
        lead.style.margin = '0 0 8px';
        if (ready || preparedByContract) {
          lead.textContent = 'Secure checkout is ready. Tap to continue:';
        } else if (cartCount < 1) {
          lead.textContent = 'Cart is empty. What are you checking out?';
        } else {
          lead.textContent = 'Almost there—your checkout is preparing. Try again in a moment.';
        }
        bubble.appendChild(lead);

        if (ready || preparedByContract) {
          const payBtn = document.createElement('button');
          payBtn.type = 'button';
          payBtn.className = 'cc-btn cc-btn-primary';
          payBtn.textContent = displayAmt != null
            ? 'Continue secure checkout ($' + displayAmt.toFixed(2) + ')'
            : 'Continue secure checkout';
          payBtn.addEventListener('click', function () {
            removePayCTAInChat();
            openPayConfirmationModal();
          });
          bubble.appendChild(payBtn);
        }

        log.appendChild(bubble);
        log.scrollTop = log.scrollHeight;
      }

      function focusPrimaryCheckoutControl() {
        // Chat-only flow: keep focus behavior minimal to avoid scroll jumps.
      }

      function openPayConfirmationModal() {
        // Inline chat checkout: collect billing + contact, then Stripe Elements (Payment Element) using PI client_secret.
        if (!product) return;
        if (!canOpenPaymentPanel()) {
          // Prepared stage can exist server-side before this tab has synced stage contract.
          // Retry once after a contract sync so CTA/modal paths are resilient to timing.
          syncCheckoutContractFromServer()
            .then(function () {
              if (canOpenPaymentPanel()) openPayConfirmationModal();
            })
            .catch(function () {});
          return;
        }
        markJourneyFlag('checkoutStarted', true);
        journeyType = 'checkout_returning';
        checkoutIntent = true;
        setCheckoutStage('payment');

        var log = document.getElementById('chatLog');
        if (!log) return;

        try {
          removePayCTAInChat();
        } catch (_) {}

        var old = document.getElementById('ccPayConfirmChatBubble');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        destroyStripePaymentUi();

        var bubble = document.createElement('div');
        bubble.id = 'ccPayConfirmChatBubble';
        bubble.className = 'cc-msg cc-msg-assistant';
        bubble.setAttribute('role', 'group');
        bubble.setAttribute('aria-label', 'Checkout');

        var header = document.createElement('p');
        header.style.margin = '0 0 8px';
        header.innerHTML = normalizeInlineMarkdownToHtml(
          String(
            kellyCopy('inlinePayKellyLead') ||
              'Review billing details for your card, then enter card details securely below. Shipping remains the address you verified in chat.'
          )
        );
        bubble.appendChild(header);

        function addLabel(text) {
          var lab = document.createElement('label');
          lab.className = 'cc-billing-label';
          lab.textContent = text;
          bubble.appendChild(lab);
        }

        addLabel('Full name (billing)');
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.autocomplete = 'name';
        nameInput.className = 'cc-input';
        nameInput.placeholder = 'Name on card';
        bubble.appendChild(nameInput);

        addLabel('Billing street address');
        var line1Input = document.createElement('input');
        line1Input.type = 'text';
        line1Input.autocomplete = 'address-line1';
        line1Input.className = 'cc-input';
        line1Input.placeholder = 'Address line 1';
        bubble.appendChild(line1Input);

        var line2Input = document.createElement('input');
        line2Input.type = 'text';
        line2Input.autocomplete = 'address-line2';
        line2Input.className = 'cc-input';
        line2Input.placeholder = 'Apartment, suite (optional)';
        bubble.appendChild(line2Input);

        var cityStateZip = document.createElement('div');
        cityStateZip.className = 'cc-billing-grid';
        bubble.appendChild(cityStateZip);

        function mkField(placeholder, autocomplete) {
          var i = document.createElement('input');
          i.type = 'text';
          i.autocomplete = autocomplete;
          i.className = 'cc-input';
          i.placeholder = placeholder;
          return i;
        }

        var cityInput = mkField('City', 'address-level2');
        var stateInput = mkField('State', 'address-level1');
        var zipInput = mkField('ZIP', 'postal-code');
        cityStateZip.appendChild(cityInput);
        cityStateZip.appendChild(stateInput);
        cityStateZip.appendChild(zipInput);

        addLabel('Phone');
        var phoneInput = document.createElement('input');
        phoneInput.type = 'tel';
        phoneInput.autocomplete = 'tel';
        phoneInput.inputMode = 'tel';
        phoneInput.className = 'cc-input';
        phoneInput.placeholder = 'E.g. +1 555 123 4567';
        bubble.appendChild(phoneInput);

        addLabel('Email for receipt');
        var emailInput = document.createElement('input');
        emailInput.type = 'email';
        emailInput.autocomplete = 'email';
        emailInput.className = 'cc-input';
        bubble.appendChild(emailInput);

        var verifyHint = document.createElement('p');
        verifyHint.style.margin = '8px 0 2px';
        verifyHint.style.fontSize = '0.9rem';
        verifyHint.style.color = 'var(--brand-gray)';
        verifyHint.textContent = 'Email verification is completed in chat before payment.';
        bubble.appendChild(verifyHint);
        var payStateHint = document.createElement('p');
        payStateHint.style.margin = '6px 0 8px';
        payStateHint.style.fontSize = '0.85rem';
        payStateHint.style.color = 'var(--brand-gray)';
        payStateHint.textContent = 'Payment not started yet.';
        bubble.appendChild(payStateHint);

        addLabel('Card details (Stripe secure field, includes CVC)');
        var stripeMount = document.createElement('div');
        stripeMount.className = 'cc-stripe-mount';
        stripeMount.id = 'ccStripePaymentMount';
        bubble.appendChild(stripeMount);

        var errEl = document.createElement('p');
        errEl.className = 'cc-error hidden';
        errEl.style.margin = '6px 0 10px';
        bubble.appendChild(errEl);

        var actions = document.createElement('div');
        actions.className = 'cc-modal-actions';
        actions.style.marginTop = '6px';

        var payBtn = document.createElement('button');
        payBtn.type = 'button';
        payBtn.className = 'cc-btn cc-btn-primary';
        payBtn.textContent = 'Pay securely';
        payBtn.disabled = true;
        actions.appendChild(payBtn);

        var retryMountBtn = document.createElement('button');
        retryMountBtn.type = 'button';
        retryMountBtn.className = 'cc-btn cc-btn-secondary hidden';
        retryMountBtn.textContent = 'Retry card fields';
        actions.appendChild(retryMountBtn);

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'cc-btn cc-btn-secondary';
        cancelBtn.textContent = 'Cancel';
        actions.appendChild(cancelBtn);

        bubble.appendChild(actions);
        log.appendChild(bubble);
        log.scrollTop = log.scrollHeight;

        setTimeout(function () {
          try {
            nameInput.focus();
          } catch (_) {}
        }, 0);

        function isChatVerificationSatisfied() {
          var stage = latestCheckoutContract && latestCheckoutContract.checkout_stage
            ? String(latestCheckoutContract.checkout_stage)
            : '';
          return stage === 'checkout_prepared' || stage === 'payment_confirmed';
        }
        let stripeElementReady = false;
        let stripeMountInFlight = false;
        let preparedCheckoutContext = null;
        let mountedClientSecret = '';
        let autoMountTimer = null;
        payBtn.disabled = true;

        function readShippingAddressObject() {
          return {
            line1: String(line1Input.value || '').trim(),
            line2: String(line2Input.value || '').trim(),
            city: String(cityInput.value || '').trim(),
            state: String(stateInput.value || '').trim(),
            postal_code: String(zipInput.value || '').trim()
          };
        }

        function formatShippingAddressLine(obj) {
          const parts = [];
          if (obj.line1) parts.push(obj.line1);
          if (obj.line2) parts.push(obj.line2);
          const tail = [obj.city, obj.state, obj.postal_code].filter(Boolean).join(', ');
          if (tail) parts.push(tail);
          return parts.join(' · ');
        }

        function normalizePhoneForCheckout(rawPhone) {
          try {
            if (typeof window !== 'undefined' && typeof window.normalizeToE164Checkout === 'function') {
              return window.normalizeToE164Checkout(rawPhone);
            }
          } catch (_) {}
          return '';
        }

        function collectPaymentDetails() {
          const shipObj = readShippingAddressObject();
          return {
            email: String(emailInput.value || '').trim().toLowerCase(),
            name: String(nameInput.value || '').trim(),
            phone: normalizePhoneForCheckout(phoneInput.value),
            shipping_address: shipObj,
            email_verified: isChatVerificationSatisfied()
          };
        }

        function getMountReadinessError(details) {
          if (!details.email) return (KELLY_COPY.emailRequired || 'Add your email for receipt.');
          if (!details.name) return 'Please add your billing name.';
          const ship = details.shipping_address || {};
          if (!ship.line1 || !ship.city || !ship.state || !ship.postal_code) {
            return 'Please add your full billing address (street, city, state, ZIP).';
          }
          if (!details.phone || !/^\+\d{8,15}$/.test(String(details.phone || ''))) {
            return 'Please enter phone with country code (for example +1..., +254...).';
          }
          if (!details.email_verified) return 'Please verify your email in chat before paying.';
          return '';
        }

        async function prepareCheckoutSession(details) {
          const emailTrim = String(details.email || '').trim();
          const nameTrim = String(details.name || '').trim();
          const phoneTrim = String(details.phone || '').trim();
          const ship = details.shipping_address || {};
          const localVerified = !!details.email_verified;

          if (!emailTrim) throw new Error(KELLY_COPY.emailRequired || 'email_required');
          if (!nameTrim) throw new Error('Please add your billing name.');
          if (!ship.line1 || !ship.city || !ship.state || !ship.postal_code) {
            throw new Error('Please add your full billing address (street, city, state, ZIP).');
          }
          if (!phoneTrim) throw new Error('Please add a phone number for this order.');
          if (!localVerified) throw new Error('Please verify your email in chat before paying.');

          const idemKey =
            quoteId && emailTrim ? 'cart_checkout:' + String(quoteId) + ':' + String(emailTrim) : '';

          const cartBody = {
            provider_id: merchantId || undefined,
            session_id: cartSessionId,
            email: emailTrim,
            name: nameTrim,
            phone: phoneTrim,
            payment_method: 'direct_stripe',
            shipping_address: ship,
            kelly_session_id: ensureKellySessionId()
          };
          if (quoteId) {
            cartBody.quote_id = quoteId;
            cartBody.commerce_quote_id = quoteId;
          }

          const cartRes = await fetch(API_BASE + '/api/public/commerce/cart/checkout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'ngrok-skip-browser-warning': 'true',
              ...(idemKey ? { 'Idempotency-Key': idemKey } : {})
            },
            body: JSON.stringify(cartBody)
          });
          const cartPayload = await cartRes.json();

          if (cartRes.ok && cartPayload && cartPayload.success && cartPayload.checkout) {
            const pa = pickPaymentActionFromSources(cartPayload.checkout, commerceCheckoutFromAgent);
            return { serverCheckout: cartPayload.checkout, payment_action: pa, source: 'cart' };
          }
          const body = {
            provider_id: merchantId || undefined,
            email: emailTrim,
            name: nameTrim,
            phone: phoneTrim,
            prescription_id: product.id,
            quantity: 1,
            payment_method: 'direct_stripe',
            kelly_session_id: ensureKellySessionId(),
            shipping_address: ship
          };
          if (quoteId) {
            body.quote_id = quoteId;
            body.checkout_session_id = quoteId;
          }

          const idem2 = quoteId ? quoteId + ':' + emailTrim : '';
          const res = await fetch(API_BASE + '/api/public/checkout/start', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'ngrok-skip-browser-warning': 'true',
              ...(idem2 ? { 'Idempotency-Key': idem2 } : {})
            },
            body: JSON.stringify(body)
          });
          const payload = await res.json();
          if (!res.ok || !payload.success) {
            throw new Error((payload && payload.error) || 'Checkout failed');
          }
          const chk = payload.checkout || {};
          const pa = pickPaymentActionFromSources(chk, commerceCheckoutFromAgent);
          return { serverCheckout: chk, payment_action: pa, source: 'single' };
        }

        async function ensureStripeElementReady() {
          if (stripeElementReady) return preparedCheckoutContext;
          if (stripeMountInFlight) return null;
          errEl.classList.add('hidden');
          if (payErr) payErr.classList.add('hidden');
          retryMountBtn.classList.add('hidden');

          stripeMountInFlight = true;
          payBtn.disabled = true;
          retryMountBtn.disabled = true;
          payStateHint.textContent = 'Loading secure card fields...';
          stripeMount.setAttribute('aria-busy', 'true');
          try {
            const details = collectPaymentDetails();
            const stageCheckout =
              latestCheckoutContract &&
              latestCheckoutContract.commerce_checkout &&
              typeof latestCheckoutContract.commerce_checkout === 'object'
                ? latestCheckoutContract.commerce_checkout
                : (latestCheckoutContract || null);
            const pa = pickPaymentActionFromSources(stageCheckout, commerceCheckoutFromAgent);
            const serverCheckout = stageCheckout || null;
            const prep = { serverCheckout: serverCheckout, payment_action: pa, source: 'prepared_contract' };

            if (pa && pa.type === 'payment_link' && pa.url) {
              window.location.assign(String(pa.url));
              return null;
            }

            const clientSecret =
              pa && pa.type === 'stripe_payment_intent' && pa.client_secret
                ? String(pa.client_secret)
                : serverCheckout &&
                  (serverCheckout.client_secret || (serverCheckout.payment && serverCheckout.payment.client_secret))
                  ? String(serverCheckout.client_secret || (serverCheckout.payment && serverCheckout.payment.client_secret))
                  : '';
            let resolvedClientSecret = clientSecret;
            if (!resolvedClientSecret) {
              const persisted = readPersistedStripeContract();
              if (persisted && persisted.payment_action && persisted.payment_action.client_secret) {
                resolvedClientSecret = String(persisted.payment_action.client_secret);
              }
            }
            if (!resolvedClientSecret) {
              await syncCheckoutContractFromServer();
              const c2 = latestCheckoutContract || {};
              const co2 = c2.commerce_checkout && typeof c2.commerce_checkout === 'object' ? c2.commerce_checkout : null;
              const pa2 = (co2 && co2.payment_action) || c2.payment_action || null;
              if (pa2 && pa2.type === 'stripe_payment_intent' && pa2.client_secret) {
                resolvedClientSecret = String(pa2.client_secret);
              } else {
                const chk2 = c2.checkout || null;
                const cs2 = chk2 && (chk2.client_secret || (chk2.payment && chk2.payment.client_secret));
                if (cs2) resolvedClientSecret = String(cs2);
              }
            }
            if (!resolvedClientSecret) {
              try {
                payStateHint.textContent = 'Syncing secure payment session...';
                const resyncRes = await fetch(API_BASE + '/api/public/checkout-chat/turn', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
                  body: JSON.stringify({
                    message: 'continue secure checkout',
                    product_id: currentProductId,
                    provider_id: merchantId,
                    session_id: ensureKellySessionId()
                  })
                });
                const resyncPayload = await resyncRes.json().catch(function () { return {}; });
                if (resyncRes.ok && resyncPayload && resyncPayload.success) {
                  applyStageContract(resyncPayload);
                  if (resyncPayload.commerce_checkout) {
                    applyCommerceCheckoutFromPayload(resyncPayload.commerce_checkout);
                  }
                  const c3 = latestCheckoutContract || {};
                  const co3 = c3.commerce_checkout && typeof c3.commerce_checkout === 'object' ? c3.commerce_checkout : null;
                  const pa3 = (co3 && co3.payment_action) || c3.payment_action || null;
                  if (pa3 && pa3.type === 'stripe_payment_intent' && pa3.client_secret) {
                    resolvedClientSecret = String(pa3.client_secret);
                  }
                }
              } catch (_) {}
            }
            if (!resolvedClientSecret) {
              const refreshed = await refreshCheckoutPaymentSession('missing_client_secret_on_mount');
              const pa4 = refreshed && refreshed.commerce_checkout && refreshed.commerce_checkout.payment_action
                ? refreshed.commerce_checkout.payment_action
                : null;
              if (pa4 && pa4.type === 'stripe_payment_intent' && pa4.client_secret) {
                resolvedClientSecret = String(pa4.client_secret);
              }
            }

            if (!resolvedClientSecret) {
              throw new Error('Secure card fields are not ready yet. Continue secure checkout in chat first.');
            }

            await mountStripePaymentElement(stripeMount, resolvedClientSecret);
            const piForPersist = pa && pa.payment_intent_id ? String(pa.payment_intent_id) : '';
            if (piForPersist) {
              persistStripeContract({ type: 'stripe_payment_intent', client_secret: resolvedClientSecret, payment_intent_id: piForPersist }, null);
            }
            stripeElementReady = true;
            mountedClientSecret = String(resolvedClientSecret || '');
            preparedCheckoutContext = { prep: prep, details: details, clientSecret: resolvedClientSecret };
            payStateHint.textContent = stripeElementMode === 'card'
              ? 'Card fields ready (card form). Tap Pay securely to complete payment.'
              : 'Card fields ready. Tap Pay securely to complete payment.';
            payBtn.disabled = false;
            retryMountBtn.classList.add('hidden');
            return preparedCheckoutContext;
          } catch (e) {
            stripeElementReady = false;
            mountedClientSecret = '';
            preparedCheckoutContext = null;
            errEl.textContent = (e && e.message) || 'Could not load card fields';
            errEl.classList.remove('hidden');
            payStateHint.textContent = 'Card fields failed to load. Tap Retry card fields.';
            payBtn.disabled = true;
            retryMountBtn.classList.remove('hidden');
            return null;
          } finally {
            stripeMount.removeAttribute('aria-busy');
            stripeMountInFlight = false;
            retryMountBtn.disabled = false;
          }
        }

        function scheduleStripeAutoMount() {
          if (stripeElementReady || stripeMountInFlight) return;
          if (autoMountTimer) clearTimeout(autoMountTimer);
          autoMountTimer = setTimeout(function () {
            void ensureStripeElementReady();
          }, 200);
        }

        async function refreshCheckoutPaymentSession(reason) {
          try {
            const sessionId = ensureKellySessionId();
            if (!sessionId) return null;
            const res = await fetch(API_BASE + '/api/public/checkout-chat/payment-session/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
              body: JSON.stringify({
                session_id: sessionId,
                provider_id: merchantId || undefined,
                product_id: currentProductId || undefined,
                reason: String(reason || 'stale_payment_intent')
              })
            });
            const payload = await res.json().catch(function () { return {}; });
            if (!res.ok || !payload || payload.success === false) return null;
            applyStageContract(payload);
            if (payload.commerce_checkout) applyCommerceCheckoutFromPayload(payload.commerce_checkout);
            return payload;
          } catch (_) {
            return null;
          }
        }

        function resolveLatestClientSecretFromContracts() {
          try {
            const c = latestCheckoutContract || {};
            const co = c.commerce_checkout && typeof c.commerce_checkout === 'object' ? c.commerce_checkout : null;
            const pa = (co && co.payment_action) || c.payment_action || null;
            if (pa && pa.type === 'stripe_payment_intent' && pa.client_secret) return String(pa.client_secret);
            const chk = c.checkout || null;
            const cs = chk && (chk.client_secret || (chk.payment && chk.payment.client_secret));
            if (cs) return String(cs);
          } catch (_) {}
          try {
            const persisted = readPersistedStripeContract();
            if (persisted && persisted.payment_action && persisted.payment_action.client_secret) {
              return String(persisted.payment_action.client_secret);
            }
          } catch (_) {}
          return '';
        }

        async function startInlineStripePayment() {
          if (paymentInFlight) return;
          errEl.classList.add('hidden');
          if (payErr) payErr.classList.add('hidden');
          const ctx = await ensureStripeElementReady();
          if (!ctx || !stripeElementReady) {
            const details = collectPaymentDetails();
            const readinessError = getMountReadinessError(details);
            if (readinessError) {
              errEl.textContent = readinessError;
              errEl.classList.remove('hidden');
            }
            return;
          }

          const details = collectPaymentDetails();
          const submitReadinessError = getMountReadinessError(details);
          if (submitReadinessError) {
            errEl.textContent = submitReadinessError;
            errEl.classList.remove('hidden');
            payStateHint.textContent = submitReadinessError;
            payBtn.disabled = false;
            return;
          }
          const shipObj = details.shipping_address || {};
          const addrLine = formatShippingAddressLine(shipObj);
          const clientSecret = String(ctx.clientSecret || '');
          const serverCheckout = ctx.prep && ctx.prep.serverCheckout;

          await syncCheckoutContractFromServer();
          const latestContractSecret = resolveLatestClientSecretFromContracts();
          if (
            latestContractSecret &&
            mountedClientSecret &&
            String(mountedClientSecret) !== String(latestContractSecret)
          ) {
            stripeElementReady = false;
            mountedClientSecret = '';
            preparedCheckoutContext = null;
            payStateHint.textContent = 'Payment session updated. Remounting secure card fields...';
            await ensureStripeElementReady();
            throw new Error('Payment session changed. Card fields were remounted; please tap Pay securely again.');
          }

          payBtn.disabled = true;
          paymentInFlight = true;
          payStateHint.textContent = 'Processing payment securely. Please wait...';
          try {
            setCheckoutStage('payment');
            emitFunnelEvent('pay_started', { product_id: product.id, quote_id: quoteId || undefined });

            const stripe = await ensureStripeClient();
            const returnUrl = window.location.href;
            let error;
            let paymentIntent;
            if (stripeElementMode === 'card' && stripeCardElementRef) {
              const cardConfirm = await stripe.confirmCardPayment(clientSecret, {
                payment_method: {
                  card: stripeCardElementRef,
                  billing_details: {
                    name: String(details.name || '').trim(),
                    email: String(details.email || '').trim(),
                    phone: String(details.phone || '').trim(),
                    address: {
                      line1: String(shipObj.line1 || '').trim(),
                      line2: String(shipObj.line2 || '').trim() || undefined,
                      city: String(shipObj.city || '').trim(),
                      state: String(shipObj.state || '').trim(),
                      postal_code: String(shipObj.postal_code || '').trim(),
                      country: 'US'
                    }
                  }
                },
                receipt_email: String(details.email || '').trim(),
                return_url: returnUrl
              }, { handleActions: true });
              error = cardConfirm && cardConfirm.error;
              paymentIntent = cardConfirm && cardConfirm.paymentIntent;
            } else {
              const paymentConfirm = await stripe.confirmPayment({
                elements: stripeElementsRef,
                confirmParams: {
                  return_url: returnUrl,
                  receipt_email: String(details.email || '').trim()
                },
                redirect: 'if_required'
              });
              error = paymentConfirm && paymentConfirm.error;
              paymentIntent = paymentConfirm && paymentConfirm.paymentIntent;
            }

            if (error) {
              throw new Error(error.message || 'payment_failed');
            }

            const piStatus = paymentIntent && paymentIntent.status;
            if (piStatus && piStatus !== 'succeeded' && piStatus !== 'processing') {
              throw new Error('Payment not completed yet. Please try again.');
            }

            const piIdFromClientSecret =
              clientSecret && typeof clientSecret === 'string' && clientSecret.includes('_secret_')
                ? String(clientSecret).split('_secret_')[0]
                : null;
            const piId = (paymentIntent && paymentIntent.id) ? paymentIntent.id : piIdFromClientSecret;
            try {
              console.info('[checkout-debug] pre-confirm', {
                session_id: ensureKellySessionId(),
                mounted_client_secret_pi: piIdFromClientSecret,
                payment_intent_id_from_stripe: paymentIntent && paymentIntent.id ? paymentIntent.id : null,
                payment_intent_status: piStatus || null
              });
            } catch (_) {}

            // Only finalize when Stripe reports succeeded/processing (backend will still re-check).
            if ((piStatus === 'succeeded' || piStatus === 'processing') && piId) {
              try {
                const confirmRes = await fetch(API_BASE + '/api/public/commerce/stripe/confirm-payment', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': 'true'
                  },
                  body: JSON.stringify({
                    payment_intent_id: piId,
                    session_id: ensureKellySessionId(),
                    provider_id: merchantId || undefined
                  })
                });
                const confirmPayload = await confirmRes.json().catch(function () {
                  return {};
                });
                if (!confirmRes.ok || !confirmPayload.success) {
                  throw new Error(
                    (confirmPayload && (confirmPayload.message || confirmPayload.error)) ||
                      'confirm_payment_failed'
                  );
                }
              } catch (confirmErr) {
                throw new Error(
                  (confirmErr && confirmErr.message) || 'Could not finalize payment on the server. Try again.'
                );
              }
            }

            const checkoutId =
              (serverCheckout && serverCheckout.checkout_id) ||
              (paymentIntent && paymentIntent.metadata && paymentIntent.metadata.checkout_id) ||
              null;

            await finalizeSuccessfulInChatCheckout({
              checkout_id: checkoutId,
              email: String(details.email || '').trim(),
              billing_name: String(details.name || '').trim(),
              phone: String(details.phone || '').trim(),
              address_line: addrLine,
              amount: cartState && cartState.subtotal != null ? Number(cartState.subtotal) : null
            });
          } catch (e) {
            emitFunnelEvent('pay_fail', { product_id: product && product.id, error: (e && e.message) || 'unknown' });
            const errMsg = String((e && e.message) || 'Payment failed');
            const stalePi = /no such payment[_ ]intent|resource_missing/i.test(errMsg);
            try {
              console.warn('[checkout-debug] confirm-error', {
                session_id: ensureKellySessionId(),
                message: errMsg,
                stale_pi: stalePi
              });
            } catch (_) {}
            if (stalePi) {
              const refreshed = await refreshCheckoutPaymentSession('stale_payment_intent_confirm');
              if (refreshed) {
                stripeElementReady = false;
                mountedClientSecret = '';
                preparedCheckoutContext = null;
                payStateHint.textContent = 'Payment session refreshed. Remounting secure card fields...';
                await ensureStripeElementReady();
                payStateHint.textContent = 'Payment session refreshed. Tap Pay securely again.';
                retryMountBtn.classList.remove('hidden');
                errEl.classList.add('hidden');
                return;
              }
            }
            errEl.textContent = errMsg;
            errEl.classList.remove('hidden');
            payStateHint.textContent = stalePi
              ? 'Payment session expired. Tap Retry card fields.'
              : 'Payment failed. Use Continue to retry secure checkout.';
          } finally {
            paymentInFlight = false;
            payBtn.disabled = !stripeElementReady;
          }
        }

        [nameInput, line1Input, cityInput, stateInput, zipInput, phoneInput, emailInput].forEach(function (el) {
          if (!el) return;
          el.addEventListener('input', scheduleStripeAutoMount);
          el.addEventListener('blur', scheduleStripeAutoMount);
        });
        phoneInput.addEventListener('blur', function () {
          var normalized = normalizePhoneForCheckout(phoneInput.value);
          if (normalized) phoneInput.value = normalized;
        });
        scheduleStripeAutoMount();

        payBtn.addEventListener('click', function () {
          startInlineStripePayment();
        });
        retryMountBtn.addEventListener('click', function () {
          void ensureStripeElementReady();
        });

        cancelBtn.addEventListener('click', function () {
          destroyStripePaymentUi();
          if (bubble && bubble.parentNode) bubble.parentNode.removeChild(bubble);
          checkoutIntent = true;
          setCheckoutStage('cart');
          try {
            renderPayCTAInChat();
          } catch (_) {}
        });
      }
      try { window.openPayConfirmationModal = openPayConfirmationModal; } catch (_) {}

      function nudgeStorageKey() {
        return 'checkout_nudge_last_' + String(currentProductId || 'unknown');
      }

      function canShowTurnNudge() {
        try {
          const raw = localStorage.getItem(nudgeStorageKey());
          if (!raw) return true;
          const last = parseInt(raw, 10);
          if (!Number.isFinite(last)) return true;
          return Date.now() - last > 24 * 60 * 60 * 1000;
        } catch (_) {
          return true;
        }
      }

      function markTurnNudgeShown() {
        try {
          localStorage.setItem(nudgeStorageKey(), String(Date.now()));
        } catch (_) {}
      }

      function setPriceLoading(loading) {
        if (!elPrice) return;
        if (loading) {
          if (elPrice.dataset.prevBackup == null) {
            elPrice.dataset.prevBackup = elPrice.textContent || '';
          }
          elPrice.textContent = kellyCopy('priceUpdating');
          elPrice.classList.add('cc-price--skeleton');
          elPrice.setAttribute('aria-busy', 'true');
        } else {
          elPrice.classList.remove('cc-price--skeleton');
          elPrice.removeAttribute('aria-busy');
        }
      }

      function restorePriceFromBackup() {
        if (elPrice && elPrice.dataset.prevBackup != null) {
          elPrice.textContent = elPrice.dataset.prevBackup;
          delete elPrice.dataset.prevBackup;
        }
      }

      function clearPriceBackup() {
        if (elPrice && elPrice.dataset.prevBackup != null) {
          delete elPrice.dataset.prevBackup;
        }
      }

      function pulseQuotedPrice() {
        if (!elPrice) return;
        elPrice.classList.add('cc-price--highlight');
        elPrice.classList.add('cc-price--quoted-pulse');
        window.setTimeout(function () {
          if (elPrice) elPrice.classList.remove('cc-price--quoted-pulse');
        }, 1400);
      }

      function removeTypingIndicator() {
        const t = document.getElementById('ccTypingIndicator');
        if (t) t.remove();
      }

      function showTypingIndicator() {
        removeTypingIndicator();
        const log = document.getElementById('chatLog');
        if (!log) return;
        const row = document.createElement('div');
        row.id = 'ccTypingIndicator';
        row.className = 'cc-typing-row';
        row.setAttribute('aria-live', 'polite');
        const dots = document.createElement('span');
        dots.className = 'cc-typing-dots';
        dots.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 3; i++) {
          dots.appendChild(document.createElement('span'));
        }
        const lab = document.createElement('span');
        lab.textContent = kellyCopy('typingIndicator');
        row.appendChild(dots);
        row.appendChild(lab);
        log.appendChild(row);
        log.scrollTop = log.scrollHeight;
      }

      function queueTypingIndicator() {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(showTypingIndicator);
          });
        } else {
          window.setTimeout(showTypingIndicator, 0);
        }
      }

      function maybeShowConversionChip(assistantText) {
        if (checkoutIntent || uiMode !== 'learn') return;
        const s = String(assistantText || '').trim();
        if (s.length < 24) return;
        const log = document.getElementById('chatLog');
        if (!log) return;
        const old = document.getElementById('lastConversionChip');
        if (old) old.remove();
        const wrap = document.createElement('div');
        wrap.id = 'lastConversionChip';
        wrap.className = 'cc-conversion-chip';
        const line = document.createElement('span');
        line.textContent = kellyCopy('chipReadyCheckout');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cc-chip-btn';
        btn.textContent = kellyCopy('chipCheckoutCta') || 'Continue';
        btn.addEventListener('click', function () {
          markJourneyFlag('checkoutStarted', true);
          journeyType = 'checkout_returning';
          checkoutIntent = true;
          applyUiMode('checkout', 'in_chat_conversion');
          void bootstrapCartWithCurrentProduct().then(function () {
            return fetchQuote();
          });
        });
        wrap.appendChild(line);
        wrap.appendChild(btn);
        log.appendChild(wrap);
        log.scrollTop = log.scrollHeight;
      }

      function maybeShowTurnNudgeStrip() { return; }

      function hideTurnNudgeStrip() {
        return;
      }

      function emitFunnelEvent(name, detail) {
        try {
          if (typeof window !== 'undefined' && Array.isArray(window.dataLayer)) {
            window.dataLayer.push({ event: name, ...(detail || {}) });
          }
          window.dispatchEvent(new CustomEvent('checkout-funnel', { detail: { name: name, ...(detail || {}) } }));
        } catch (_) {}
      }

      if (currentProductId) {
        emitFunnelEvent('checkout_chat_open', {
          product_id: currentProductId,
          provider_id: currentMerchantId || undefined,
          mode: uiMode,
          journey_type: journeyType,
          phase3_enabled: !!phase3Enabled
        });
      }

      window.addEventListener('pagehide', function () {
        try {
          if (uiMode === 'checkout' && checkoutStage !== 'confirm') {
            emitFunnelEvent('checkout_flow_incomplete', {
              product_id: currentProductId || undefined,
              stage: checkoutStage
            });
          }
        } catch (_) {}
      });

      function showErr(msg, opts) {
        opts = opts || {};
        if (elErrText) elErrText.textContent = msg;
        if (elErrShop) {
          elErrShop.textContent = kellyCopy('backToShop') || 'Back to shop';
          if (typeof window.LANDING_BASE === 'string' && window.LANDING_BASE) {
            elErrShop.href = window.LANDING_BASE;
          } else {
            elErrShop.href = '/unified-dashboard/littlelab-landing/public/index.html';
          }
        }
        if (elErrRetry) {
          if (opts.catalogRetry) elErrRetry.classList.remove('hidden');
          else elErrRetry.classList.add('hidden');
        }
        if (elErr) elErr.classList.remove('hidden');
      }

      function appendAssistantErrorCard(text) {
        const log = document.getElementById('chatLog');
        if (!log) return;
        const wrap = document.createElement('div');
        wrap.className = 'cc-msg-error-card';
        wrap.setAttribute('role', 'alert');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'cc-heroicon');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke-width', '1.5');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute(
          'd',
          'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z'
        );
        svg.appendChild(path);
        const p = document.createElement('p');
        p.textContent = text;
        wrap.appendChild(svg);
        wrap.appendChild(p);
        if (lastSentUserMessage) {
          const retryBtn = document.createElement('button');
          retryBtn.type = 'button';
          retryBtn.className = 'cc-chip-btn';
          retryBtn.textContent = 'Retry last message';
          retryBtn.addEventListener('click', function () {
            const composerEl = document.getElementById('composer');
            if (composerEl) composerEl.value = lastSentUserMessage;
            sendKellyMessage();
          });
          wrap.appendChild(retryBtn);
        }
        log.appendChild(wrap);
        log.scrollTop = log.scrollHeight;
        updateChatEmptyState();
      }

      function skipProductSwitchConfirm() {
        try {
          return sessionStorage.getItem('cc_skip_product_switch_confirm') === '1';
        } catch (_) {
          return false;
        }
      }

      let pendingSwitchProduct = null;

      function requestSwitchProduct(p) {
        if (!p) return;
        if (String(p.id) === String(currentProductId)) {
          closeProductSheet();
          return;
        }
        if (skipProductSwitchConfirm()) {
          switchProduct(String(p.id));
          closeProductSheet();
          return;
        }
        pendingSwitchProduct = p;
        const confirmText = document.getElementById('productSwitchConfirmText');
        const nm = displaySerumName(p.name || p.title || p.id);
        if (confirmText) {
          confirmText.textContent = (kellyCopy('switchConfirmLead') || 'Switch to ') + nm + '?';
        }
        const list = document.getElementById('productSheetList');
        const conf = document.getElementById('productSwitchConfirm');
        if (list) list.classList.add('hidden');
        if (conf) conf.classList.remove('hidden');
      }

      if (checkoutSessionId && sessionNote) {
        sessionNote.textContent = KELLY_COPY.sessionNoteCheckout;
        sessionNote.classList.remove('hidden');
      }

      function sessionChatSessionKey() {
        const productScope = String(currentProductId || 'unknown');
        const merchantScope = String(currentMerchantId || params.get('provider_id') || 'unknown_merchant');
        const modeScope = String(uiMode || 'learn');
        const identitySeed = String(sid || 'guest');
        let identityHash = 0;
        for (let i = 0; i < identitySeed.length; i++) {
          identityHash = (identityHash * 31 + identitySeed.charCodeAt(i)) >>> 0;
        }
        return 'checkout_kelly_session_' + productScope + '_' + merchantScope + '_' + modeScope + '_' + identityHash;
      }

      function ensureKellySessionId() {
        if (kellySessionId) return kellySessionId;
        try {
          const k = sessionChatSessionKey();
          let ls = localStorage.getItem(k);
          if (!ls) {
            ls =
              (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
              'cc-' + String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
            localStorage.setItem(k, ls);
          }
          kellySessionId = ls;
        } catch (_) {
          kellySessionId = 'cc-' + String(Date.now());
        }
        return kellySessionId;
      }

      function updateChatEmptyState() {
        const log = document.getElementById('chatLog');
        const empty = document.getElementById('chatEmptyState');
        const sysMsg = document.getElementById('sysMsg');
        if (!log || !empty) return;
        const hasSys =
          sysMsg &&
          String(sysMsg.textContent || '')
            .replace(/\s+/g, ' ')
            .trim().length > 0;
        const n = log.querySelectorAll('.cc-msg').length;
        const showEmptyInCheckout = uiMode === 'checkout' && n === 0;
        if (n === 0 && (!hasSys || showEmptyInCheckout)) {
          empty.classList.add('is-visible');
          empty.setAttribute('aria-hidden', 'false');
        } else {
          empty.classList.remove('is-visible');
          empty.setAttribute('aria-hidden', 'true');
        }
      }

      function shouldShowStarterPrompts() {
        if (uiMode !== 'learn') return false;
        const log = document.getElementById('chatLog');
        const hasUserMessage = !!(log && log.querySelector('.cc-msg-user'));
        return !hasUserMessage && userTurnCount === 0;
      }

      function syncStarterPrompts() {
        if (!learnPromptChipsEl) return;
        learnPromptChipsEl.classList.toggle('hidden', !shouldShowStarterPrompts());
      }

      function escapeHtml(s) {
        return String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function formatInlineText(s) {
        const safe = escapeHtml(s);
        return safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      }

      function formatAssistantMessageHtml(text) {
        const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
        const chunks = [];
        let listItems = [];
        let orderedItems = [];
        function flushBulleted() {
          if (!listItems.length) return;
          chunks.push('<ul>' + listItems.map(function (it) { return '<li>' + formatInlineText(it) + '</li>'; }).join('') + '</ul>');
          listItems = [];
        }
        function flushOrdered() {
          if (!orderedItems.length) return;
          chunks.push('<ol>' + orderedItems.map(function (it) { return '<li>' + formatInlineText(it) + '</li>'; }).join('') + '</ol>');
          orderedItems = [];
        }
        for (let i = 0; i < lines.length; i++) {
          const raw = lines[i];
          const line = raw.trim();
          if (!line) {
            flushBulleted();
            flushOrdered();
            continue;
          }
          const bullet = line.match(/^[-*•]\s+(.+)$/);
          if (bullet) {
            flushOrdered();
            listItems.push(bullet[1]);
            continue;
          }
          const numbered = line.match(/^\d+\.\s+(.+)$/);
          if (numbered) {
            flushBulleted();
            orderedItems.push(numbered[1]);
            continue;
          }
          flushBulleted();
          flushOrdered();
          chunks.push('<p>' + formatInlineText(line) + '</p>');
        }
        flushBulleted();
        flushOrdered();
        if (!chunks.length) return '<p></p>';
        return chunks.join('');
      }

      function appendChatBubble(role, text) {
        const log = document.getElementById('chatLog');
        if (!log) return;
        const div = document.createElement('div');
        div.className =
          'cc-msg ' + (role === 'user' ? 'cc-msg-user' : 'cc-msg-assistant');
        if (role === 'assistant') {
          div.innerHTML = formatAssistantMessageHtml(text);
        } else {
          div.textContent = text;
        }
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
        updateChatEmptyState();
        syncStarterPrompts();
      }

      function appendStructuredUiFromPayload(payload) {
        if (!payload) return;
        if (Array.isArray(payload.provider_cards) && payload.provider_cards.length) {
          appendProviderCardsBlock(payload.provider_cards);
        }
        if (Array.isArray(payload.literature_snippets) && payload.literature_snippets.length) {
          appendLiteratureBlock(payload.literature_snippets);
        }
      }

      function appendProviderCardsBlock(cards) {
        const log = document.getElementById('chatLog');
        if (!log || !cards.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'cc-msg cc-msg-assistant cc-provider-cards';
        const title = document.createElement('div');
        title.className = 'cc-provider-cards-title';
        title.textContent = 'Clinic directory';
        wrap.appendChild(title);
        const grid = document.createElement('div');
        grid.className = 'cc-provider-card-grid';
        cards.forEach(function (c) {
          const card = document.createElement('div');
          card.className = 'cc-provider-card';
          const name = document.createElement('div');
          name.className = 'cc-provider-card-name';
          name.textContent = String(c.display_name || 'Clinician');
          card.appendChild(name);
          const spec = document.createElement('div');
          spec.className = 'cc-provider-card-spec';
          spec.textContent = String(c.specialty || '');
          card.appendChild(spec);
          const actions = document.createElement('div');
          actions.className = 'cc-provider-card-actions';
          if (c.booking_url) {
            const a = document.createElement('a');
            a.className = 'cc-btn cc-btn-secondary';
            a.href = String(c.booking_url);
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = 'Book';
            actions.appendChild(a);
          }
          if (c.phone_trust === 'verified_directory' && c.phone) {
            const tel = document.createElement('a');
            tel.className = 'cc-btn cc-btn-secondary';
            tel.href = 'tel:' + String(c.phone).replace(/\s/g, '');
            tel.textContent = 'Call';
            actions.appendChild(tel);
          } else {
            const hint = document.createElement('span');
            hint.className = 'cc-provider-card-hint';
            hint.textContent = 'Contact the clinic for phone support.';
            actions.appendChild(hint);
          }
          card.appendChild(actions);
          grid.appendChild(card);
        });
        wrap.appendChild(grid);
        log.appendChild(wrap);
        log.scrollTop = log.scrollHeight;
      }

      function appendLiteratureBlock(rows) {
        const log = document.getElementById('chatLog');
        if (!log || !rows.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'cc-msg cc-msg-assistant cc-literature-snips';
        const title = document.createElement('div');
        title.className = 'cc-literature-title';
        title.textContent = 'Related citations (PubMed)';
        wrap.appendChild(title);
        const ul = document.createElement('ul');
        ul.className = 'cc-literature-list';
        rows.slice(0, 8).forEach(function (r) {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = r.url || ('https://pubmed.ncbi.nlm.nih.gov/' + encodeURIComponent(String(r.pmid || '')) + '/');
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = String(r.title || r.pmid || 'Article');
          li.appendChild(a);
          if (r.journal) {
            const meta = document.createElement('span');
            meta.className = 'cc-literature-meta';
            meta.textContent = ' — ' + String(r.journal) + (r.year ? ' (' + r.year + ')' : '');
            li.appendChild(meta);
          }
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
        const disc = document.createElement('p');
        disc.className = 'cc-literature-disclaimer';
        disc.textContent = 'For information only — not medical advice.';
        wrap.appendChild(disc);
        log.appendChild(wrap);
        log.scrollTop = log.scrollHeight;
      }

      function renderResumeBanner(resumedAtMs) {
        const log = document.getElementById('chatLog');
        if (!log) return;
        const old = document.getElementById('ccResumeBanner');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        const wrap = document.createElement('div');
        wrap.id = 'ccResumeBanner';
        wrap.className = 'cc-msg cc-msg-assistant';
        const ts = Number(resumedAtMs || Date.now());
        const when = Number.isFinite(ts) ? new Date(ts).toLocaleString() : 'just now';
        const p = document.createElement('p');
        p.style.margin = '0 0 8px';
        p.textContent = (kellyCopy('resumeBanner') || 'Resuming your previous checkout.') + ' (' + when + ').';
        wrap.appendChild(p);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cc-btn cc-btn-secondary';
        btn.textContent = kellyCopy('resumeStartOverCta') || 'Start over';
        btn.addEventListener('click', async function () {
          try {
            const sidNow = ensureKellySessionId();
            await fetch(API_BASE + '/api/public/checkout-chat/reset', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
              body: JSON.stringify({ session_id: sidNow, reason: 'resume_banner_start_over' })
            });
          } catch (_) {}
          latestCheckoutContract = null;
          checkoutIntent = false;
          pendingResumeDecision = '';
          removePayCTAInChat();
          setCheckoutStage('cart');
          wrap.remove();
        });
        wrap.appendChild(btn);
        log.appendChild(wrap);
        log.scrollTop = log.scrollHeight;
      }

      function clearChatLog() {
        const log = document.getElementById('chatLog');
        if (log) log.innerHTML = '';
        updateChatEmptyState();
        syncStarterPrompts();
      }

      function displaySerumName(raw) {
        var name = String(raw || '').trim();
        if (!name) return 'Product';
        return name.split('|')[0].trim() || name;
      }

      function displaySerumSubtitle(p) {
        if (!p) return '';
        var s = String(p.short_description || '').trim();
        if (s) return s;
        var d = String(p.description || '').trim();
        if (!d) return '';
        var first = d.split('.').map(function (x) { return x.trim(); }).filter(Boolean)[0] || '';
        return first ? (first + '.') : '';
      }

      function resetKellySessionForProductSwitch() {
        try {
          localStorage.removeItem(sessionChatSessionKey());
        } catch (_) {}
        kellySessionId = '';
        pendingResumeDecision = '';
        resumeChoiceResolvedForSession = false;
        latestCheckoutContract = null;
      }

      function landingImageOrigin() {
        try {
          if (typeof window.LANDING_BASE === 'string' && window.LANDING_BASE) {
            return new URL(window.LANDING_BASE, window.location.href).origin;
          }
        } catch (_) {}
        return '';
      }

      function productImageUrl(p) {
        if (!p) return '';
        var u = p.image_url || p.image_link || p.image || '';
        if (!u) return '';
        u = String(u).trim();
        if (/snail-mucin-serum\.png/i.test(u)) {
          u = u.replace(/snail-mucin-serum\.png/gi, 'dark-spot-repair-snail-mucin-serum.png');
        }
        if (u.startsWith('/images/') && !u.startsWith('/images/products/')) {
          u = '/images/products/' + u.replace(/^\/images\//, '');
        } else if (u.startsWith('images/') && !u.startsWith('images/products/')) {
          u = 'images/products/' + u.replace(/^images\//, '');
        }
        if (/^https?:\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return u;
        if (u.startsWith('//')) return window.location.protocol + u;
        if (u.startsWith('/')) {
          var lo = landingImageOrigin();
          if (lo) return lo + u;
          var api = (typeof API_BASE === 'string' && API_BASE) ? API_BASE.replace(/\/$/, '') : '';
          if (api) return api + u;
        }
        return u;
      }

      function setProductStripImageUrl(url, altText) {
        const img = document.getElementById('productStripImg');
        if (!img) return;
        const pandaFallback = '../assets/images/logo-panda.svg';
        if (url) {
          img.onerror = function () {
            if (img.dataset.fallbackApplied === 'id') {
              img.dataset.fallbackApplied = 'panda';
              img.src = pandaFallback;
              img.hidden = false;
              img.alt = 'Skin and Care panda';
              return;
            }
            var rel = STRIP_IMAGE_FALLBACK_BY_ID[currentProductId];
            if (rel) {
              var api = (typeof API_BASE === 'string' && API_BASE) ? API_BASE.replace(/\/$/, '') : '';
              img.dataset.fallbackApplied = 'id';
              img.src = api ? api + rel : rel;
              return;
            }
            img.dataset.fallbackApplied = 'panda';
            img.src = pandaFallback;
            img.hidden = false;
            img.alt = 'Skin and Care panda';
          };
          img.dataset.fallbackApplied = '';
          img.src = url;
          img.hidden = false;
          img.alt = altText || 'Product';
        } else {
          img.onerror = null;
          img.dataset.fallbackApplied = '0';
          img.removeAttribute('src');
          img.hidden = true;
          img.alt = '';
        }
      }

      function updateProductStripImage(p) {
        var u = productImageUrl(p);
        if (!u) {
          var rel = STRIP_IMAGE_FALLBACK_BY_ID[(p && p.id) || currentProductId];
          if (rel) {
            var apix = (typeof API_BASE === 'string' && API_BASE) ? API_BASE.replace(/\/$/, '') : '';
            u = apix ? apix + rel : rel;
          }
        }
        setProductStripImageUrl(u, (p && (p.name || p.title)) || 'Product');
      }

      function resolveDegradedStripImageUrl() {
        if (productImageHint) return productImageHint;
        var rel = STRIP_IMAGE_FALLBACK_BY_ID[currentProductId];
        if (!rel) return '';
        var lo = landingImageOrigin();
        if (lo) return lo + rel;
        return rel;
      }

      function applyCatalogDegradedUI(detail) {
        detail = detail || {};
        const status = detail.status;
        const kind = detail.kind;
        const stripEl = document.getElementById('productStrip');
        if (stripEl) stripEl.classList.remove('is-loading');
        if (elTitle) elTitle.textContent = productNameHint || 'Product';
        if (elPrice) {
          elPrice.textContent =
            'Price loads once the catalog is available — use Retry or check back shortly.';
        }
        setProductStripImageUrl(resolveDegradedStripImageUrl(), productNameHint || 'Product');
        catalogLoadOk = false;
        setCartCatalogDegraded(true);
        var msg;
        if (status === 429 || kind === 'rate_limit') {
          msg =
            'Catalog is temporarily rate-limited. Wait a few seconds, tap Retry, or return to the shop.';
        } else if (kind === 'network') {
          msg = detail.message
            ? 'Could not load catalog (' + detail.message + '). Check your connection, then tap Retry.'
            : 'Could not reach the catalog. Check your connection, then tap Retry.';
        } else {
          msg = 'Catalog is unavailable right now. Tap Retry in a moment, or return to the shop.';
        }
        showErr(msg, { catalogRetry: true });
      }

      function buildProductSheet(list) {
        const sheetList = document.getElementById('productSheetList');
        if (!sheetList) return;
        sheetList.innerHTML = '';
        if (!list || !list.length) return;
        list.forEach(function (p) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'cc-sheet-row';
          if (String(p.id) === String(currentProductId)) row.classList.add('is-active');
          const iu = productImageUrl(p);
          var thumb = null;
          if (iu) {
            thumb = document.createElement('img');
            thumb.className = 'cc-sheet-thumb';
            thumb.src = iu;
            thumb.alt = '';
            thumb.addEventListener('error', function () {
              var rel = STRIP_IMAGE_FALLBACK_BY_ID[String(p.id || '')] || '';
              if (rel) {
                var lo = landingImageOrigin();
                thumb.src = lo ? (lo + rel) : rel;
                return;
              }
              thumb.src = '/images/branding/logo-panda.png';
            }, { once: true });
          } else {
            thumb = document.createElement('div');
            thumb.className = 'cc-sheet-thumb';
            thumb.setAttribute('aria-hidden', 'true');
          }
          const tx = document.createElement('div');
          tx.className = 'cc-sheet-row-text';
          const nm = document.createElement('div');
          nm.className = 'cc-sheet-row-name';
          nm.textContent = displaySerumName(p.name || p.title || p.id);
          const prEl = document.createElement('div');
          prEl.className = 'cc-sheet-row-price';
          const pr = Number(p.price);
          prEl.textContent = Number.isFinite(pr) ? '$' + pr.toFixed(2) + ' USD' : '';
          tx.appendChild(nm);
          tx.appendChild(prEl);
          row.appendChild(thumb);
          row.appendChild(tx);
          row.addEventListener('click', function () {
            requestSwitchProduct(p);
          });
          sheetList.appendChild(row);
        });
      }

      function openProductSheet() {
        const sheet = document.getElementById('productSwitchSheet');
        const btn = document.getElementById('btnProductSwitch');
        const list = document.getElementById('productSheetList');
        const conf = document.getElementById('productSwitchConfirm');
        pendingSwitchProduct = null;
        if (list) list.classList.remove('hidden');
        if (conf) conf.classList.add('hidden');
        if (sheet) {
          sheet.classList.remove('hidden');
          sheet.classList.add('is-open');
        }
        if (btn) btn.setAttribute('aria-expanded', 'true');
      }

      function closeProductSheet() {
        const sheet = document.getElementById('productSwitchSheet');
        const btn = document.getElementById('btnProductSwitch');
        const list = document.getElementById('productSheetList');
        const conf = document.getElementById('productSwitchConfirm');
        pendingSwitchProduct = null;
        if (list) list.classList.remove('hidden');
        if (conf) conf.classList.add('hidden');
        if (sheet) {
          sheet.classList.add('hidden');
          sheet.classList.remove('is-open');
        }
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }

      function populateProductPicker(list) {
        if (!list || !list.length) return;
        catalogProducts = list;
        const wrap = document.getElementById('productPickerWrap');
        const sel = document.getElementById('productPicker');
        const btnSw = document.getElementById('btnProductSwitch');
        if (!wrap || !sel) return;
        sel.innerHTML = '';
        list.forEach(function (p) {
          const o = document.createElement('option');
          o.value = String(p.id);
          const pr = Number(p.price);
          o.textContent =
            displaySerumName(p.name || p.id) + (Number.isFinite(pr) ? ' — $' + pr.toFixed(2) : '');
          if (String(p.id) === String(currentProductId)) o.selected = true;
          sel.appendChild(o);
        });
        if (btnSw) {
          if (list.length > 1) btnSw.classList.remove('hidden');
          else btnSw.classList.add('hidden');
        }
        buildProductSheet(list);
      }

      function switchProduct(newId) {
        const p = catalogProducts.find(function (x) {
          return String(x.id) === String(newId);
        });
        if (!p) return;
        currentProductId = String(p.id);
        journeyState = readJourneyState();
        journeyType = resolveJourneyType();
        currentMerchantId = String(p.merchant_id || currentMerchantId || merchantId);
        merchantId = p.merchant_id || merchantId;
        product = p;
        elTitle.textContent = displaySerumName(p.name || productNameHint || 'Product');
        if (elSubtitle) elSubtitle.textContent = displaySerumSubtitle(p);
        const price = Number(p.price);
        elPrice.textContent =
          Number.isFinite(price) ? '$' + price.toFixed(2) : 'Price unavailable';
        updateProductStripImage(p);
        userTurnCount = 0;
        checkoutIntent = false;
        lastQuotedAmount = null;
        hideTurnNudgeStrip();
        resetKellySessionForProductSwitch();
        clearChatLog();
        appendChatBubble('assistant', kellyCopy('productSwitchAssistant'));
        emitFunnelEvent('checkout_product_switch', { product_id: currentProductId });
        fetchQuote();
        try {
          const u = new URL(window.location.href);
          u.searchParams.set('product_id', currentProductId);
          if (merchantId) u.searchParams.set('provider_id', merchantId);
          window.history.replaceState({}, '', u.toString());
        } catch (_) {}
        const selPick = document.getElementById('productPicker');
        if (selPick) selPick.value = currentProductId;
        buildProductSheet(catalogProducts);
      }

      async function loadIntakeEmail() {
        try {
          const r = await fetch(API_BASE + '/api/patient/intake', {
            headers: { 'x-session-id': sid, 'ngrok-skip-browser-warning': 'true' }
          });
          const d = await r.json();
          const em = d && d.intake && d.intake.email;
          if (em) payEmail.value = em;
        } catch (_) {}
      }

      async function loadProduct() {
        if (loadProductInFlight) return loadProductInFlight;
        loadProductInFlight = (async function () {
          const productStrip = document.getElementById('productStrip');
          if (productStrip) productStrip.classList.add('is-loading');
          if (!currentProductId) {
            if (productStrip) productStrip.classList.remove('is-loading');
            if (elTitle) elTitle.textContent = 'Product';
            if (elSubtitle) elSubtitle.textContent = '';
            if (elPrice) elPrice.textContent = '';
            catalogLoadOk = false;
            showErr('Missing product_id. Open this page from the shop or your link.', {});
            return;
          }
          try {
            const q = new URLSearchParams();
            if (merchantId) q.set('provider_id', merchantId);
            const url = API_BASE + '/api/public/products?' + q.toString();
            const res = await fetchWith429Retry(url, { headers: { 'ngrok-skip-browser-warning': 'true' } });
            var data = {};
            try {
              data = await res.json();
            } catch (_) {
              data = {};
            }
            if (!res.ok || !data.success) {
              var degradedKind = 'http';
              if (res.status === 429) degradedKind = 'rate_limit';
              applyCatalogDegradedUI({ kind: degradedKind, status: res.status });
              return;
            }
            const list = data.products || data.prescriptions || [];
            populateProductPicker(list);
            product = list.find(function (p) {
              return String(p.id) === String(currentProductId);
            });
            if (!product) {
              if (productStrip) productStrip.classList.remove('is-loading');
              catalogLoadOk = true;
              setCartCatalogDegraded(false);
              elTitle.textContent = productNameHint || 'Product';
              if (elSubtitle) elSubtitle.textContent = 'Please retry from the shop.';
              elPrice.textContent = 'Price unavailable';
              setProductStripImageUrl(resolveDegradedStripImageUrl(), productNameHint || 'Product');
              showErr('Product not found for this merchant.', {});
              if (merchantId) refreshCart().catch(function () {});
              return;
            }
            merchantId = product.merchant_id || merchantId;
            currentMerchantId = merchantId;
            elTitle.textContent = displaySerumName(product.name || productNameHint || 'Product');
            if (elSubtitle) elSubtitle.textContent = displaySerumSubtitle(product);
            const price = Number(product.price);
            elPrice.textContent =
              Number.isFinite(price) ? '$' + price.toFixed(2) : 'Price unavailable';
            updateProductStripImage(product);
            if (productStrip) productStrip.classList.remove('is-loading');
            catalogLoadOk = true;
            setCartCatalogDegraded(false);
            refreshCart().catch(function () {});
            mergeCheckoutProgressFromServer().catch(function () {});
            if (uiMode === 'checkout') {
              fetchQuote();
            } else {
              markJourneyFlag('quoteReady', false);
              updateInThreadPayUI();
            }
          } catch (e) {
            applyCatalogDegradedUI({ kind: 'network', status: 0, message: e && e.message });
          }
        })();
        try {
          await loadProductInFlight;
        } finally {
          loadProductInFlight = null;
        }
      }

      async function fetchQuote() {
        if (!currentProductId || !merchantId || !product) return;
        var whyDetails = document.getElementById('whyPriceDetails');
        if (whyDetails) whyDetails.hidden = true;
        setPriceLoading(true);
        try {
          const res = await fetch(API_BASE + '/api/public/commerce/quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({
              product_id: currentProductId,
              prescription_id: currentProductId,
              provider_id: merchantId,
              quantity: 1,
              kelly_session_id: ensureKellySessionId()
            })
          });
          const data = await res.json();
          if (!res.ok || !data.success || !data.quote_id) {
            restorePriceFromBackup();
            setPriceLoading(false);
            lastQuotedAmount = null;
            markJourneyFlag('quoteReady', false);
            updateInThreadPayUI();
            if (whyDetails) whyDetails.hidden = true;
            return;
          }
          quoteId = data.quote_id;
          setPriceLoading(false);
          if (Number.isFinite(Number(data.amount))) {
            lastQuotedAmount = Number(data.amount);
            lastQuotedCurrency = data.currency || 'USD';
            markJourneyFlag('quoteReady', true);
            clearPriceBackup();
            elPrice.textContent =
              '$' + Number(data.amount).toFixed(2);
            pulseQuotedPrice();
            if (whyDetails) whyDetails.hidden = false;
          } else {
            lastQuotedAmount = null;
            markJourneyFlag('quoteReady', false);
            restorePriceFromBackup();
            if (whyDetails) whyDetails.hidden = true;
          }
          updateInThreadPayUI();
          emitFunnelEvent('quote_shown', { product_id: currentProductId, quote_id: quoteId });
        } catch (_) {
          restorePriceFromBackup();
          setPriceLoading(false);
          lastQuotedAmount = null;
          markJourneyFlag('quoteReady', false);
          updateInThreadPayUI();
          if (whyDetails) whyDetails.hidden = true;
        }
      }

      if (elErrRetry) {
        elErrRetry.addEventListener('click', function () {
          if (elErr) elErr.classList.add('hidden');
          elErrRetry.classList.add('hidden');
          loadProduct().then(function () {
            if (catalogLoadOk) {
              setCartCatalogDegraded(false);
              refreshCart().catch(function () {});
            }
          });
        });
      }

      function maybeAppendJourneyOpener() {}

      async function runCheckoutInit() {
        if (sid) await loadIntakeEmail();
        await loadProduct();
        if (params.get('intent') === 'checkout_chat' && uiMode === 'checkout') {
          checkoutIntent = true;
          markJourneyFlag('checkoutStarted', true);
          journeyType = 'checkout_returning';
        }
        await maybePromptResumeDecisionOnEntry();
        const restoredFlow = restoreCheckoutFlowStage();
        updateChatEmptyState();
        applyUiMode(uiMode, 'init');
        syncReactiveCtas();
        if (uiMode === 'checkout') {
          if (!restoredFlow || !restoredFlow.stage) {
            setCheckoutStage('cart');
          }
        }
        if (uiMode === 'checkout' && catalogLoadOk && params.get('cart_bootstrap') === '1' && currentProductId && merchantId) {
          try {
            markJourneyFlag('checkoutStarted', true);
            journeyType = 'checkout_returning';
            await postCart('/api/public/commerce/cart/add', { product_id: currentProductId, quantity: 1 });
            await refreshCart();
            appendChatBubble(
              'assistant',
              kellyCopy('cartBootstrapAssistant') ||
                'Confirm product — I added this to your cart. Reply yes to continue, or tell me what to change.'
            );
          } catch (_) {}
        } else if (uiMode === 'checkout' && params.get('cart_bootstrap') === '1' && currentProductId && !catalogLoadOk) {
          appendChatBubble(
            'assistant',
            'The catalog did not load, so your cart was not updated. Tap Retry catalog when the network is ready.'
          );
        } else if (catalogLoadOk && uiMode === 'checkout') {
          await refreshCart().catch(function () {});
        } else if (catalogLoadOk) {
          await refreshCart().catch(function () {});
        }
        maybeAppendJourneyOpener();
        updateInThreadPayUI();
        if (quoteId && catalogLoadOk) {
          fetchQuote();
        }
        // Restore stage contract only while in checkout mode.
        if (uiMode === 'checkout') {
          await syncCheckoutContractFromServer();
        }
        syncCheckoutChrome();
      }
      runCheckoutInit();
      if (!sid && guestHintEl) {
        guestHintEl.textContent = '';
        guestHintEl.classList.add('hidden');
      }
      if (learnPromptChipsEl) {
        learnPromptChipsEl.addEventListener('click', function (e) {
          const promptBtn = e.target && e.target.closest ? e.target.closest('button[data-learn-prompt]') : null;
          if (promptBtn) {
            learnPromptChipsEl.classList.add('hidden');
            const composerEl = document.getElementById('composer');
            if (composerEl) composerEl.value = promptBtn.getAttribute('data-learn-prompt') || '';
            syncStarterPrompts();
            emitFunnelEvent('learn_prompt_chip_tap', {
              product_id: currentProductId,
              prompt: promptBtn.getAttribute('data-learn-prompt') || ''
            });
            sendKellyMessage();
          }
        });
      }

      if (btnLearnProceed) {
        btnLearnProceed.addEventListener('click', function () {
          markJourneyFlag('checkoutStarted', true);
          journeyType = 'checkout_returning';
          applyUiMode('checkout', 'learn_continue');
          setCheckoutStage('cart');
          (async function () {
            await bootstrapCartWithCurrentProduct();
            await fetchQuote();
          })();
        });
      }

      if (btnHeaderCart) {
        btnHeaderCart.addEventListener('click', function () {
          markJourneyFlag('checkoutStarted', true);
          journeyType = 'checkout_returning';
          applyUiMode('checkout', 'header_cart');
          setCheckoutStage('cart');
          (async function () {
            await bootstrapCartWithCurrentProduct();
            await fetchQuote();
          })();
        });
      }

      function setComposerStatus(text, mode) {
        const statusEl = document.getElementById('chatStatus');
        const icon = document.getElementById('chatStatusIcon');
        const wrap = document.getElementById('chatStatusWrap');
        if (statusEl) statusEl.textContent = text || '';
        if (icon) {
          if (mode === 'tool') {
            icon.classList.remove('hidden');
          } else {
            icon.classList.add('hidden');
          }
        }
        if (wrap) {
          wrap.style.color = mode === 'error' ? '#b45309' : '';
        }
      }

      async function sendKellyMessage() {
        let assistantEl = null;
        const composerEl = document.getElementById('composer');
        const text = (composerEl && composerEl.value) || '';
        const t = String(text).trim();
        if (!t) {
          if (chatStatus) chatStatus.textContent = KELLY_COPY.statusTypeFirst;
          return;
        }
        if (!currentProductId || !merchantId) {
          if (chatStatus) chatStatus.textContent = KELLY_COPY.statusProductLoading;
          return;
        }
        const effectiveSessionHeader = sid || ensureKellySessionId();
        userTurnCount += 1;
        markJourneyFlag('hasChatted', true);
        lastSentUserMessage = t;
        if (userTurnCount === 1 && !agenticPrimaryEmitted) {
          agenticPrimaryEmitted = true;
          emitFunnelEvent('agentic_primary', {
            product_id: currentProductId,
            provider_id: merchantId || undefined
          });
        }
        appendChatBubble('user', t);
        syncReactiveCtas();
        composerEl.value = '';
        queueTypingIndicator();
        setComposerStatus('', '');
        if (btnSendChat) btnSendChat.disabled = true;
        const ctrl = new AbortController();
        const to = setTimeout(function () {
          ctrl.abort();
        }, 120000);
        try {
          assistantEl = null;
          const chatStreamPath = sid ? '/api/patient/checkout-chat/turn/stream' : '/api/public/checkout-chat/turn/stream';
          const decision = String(pendingResumeDecision || '').trim();
          const res = await fetch(API_BASE + chatStreamPath, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-session-id': effectiveSessionHeader,
              'ngrok-skip-browser-warning': 'true',
              Accept: 'text/event-stream'
            },
            body: JSON.stringify({
              message: t,
              product_id: currentProductId,
              provider_id: merchantId,
              session_id: ensureKellySessionId(),
              resume_decision: decision || undefined
            }),
            signal: ctrl.signal
          });
          if (decision) pendingResumeDecision = '';
          clearTimeout(to);
          if (!res.ok) {
            throw new Error('Chat request failed (' + res.status + ')');
          }
          const reader = res.body && res.body.getReader ? res.body.getReader() : null;
          if (!reader) {
            throw new Error('Streaming not supported in this browser.');
          }
          const decoder = new TextDecoder();
          let buffer = '';
          let donePayload = null;
          let doneHandled = false;
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (let i = 0; i < parts.length; i++) {
              const line = parts[i].trim();
              if (!line.startsWith('data:')) continue;
              const jsonStr = line.replace(/^data:\s*/, '');
              let d;
              try {
                d = JSON.parse(jsonStr);
              } catch (_) {
                continue;
              }
              if (d.type === 'tool_status' && d.text) {
                removeTypingIndicator();
                setComposerStatus(String(d.text), 'tool');
              }
              if (d.type === 'delta' && d.text) {
                removeTypingIndicator();
                setComposerStatus('', '');
                if (!assistantEl) {
                  assistantEl = document.createElement('div');
                  assistantEl.className = 'cc-msg cc-msg-assistant cc-msg-streaming';
                  assistantEl.textContent = '';
                  const log = document.getElementById('chatLog');
                  if (log) {
                    log.appendChild(assistantEl);
                    log.scrollTop = log.scrollHeight;
                  }
                }
                assistantEl.textContent += d.text;
                const log2 = document.getElementById('chatLog');
                if (log2) log2.scrollTop = log2.scrollHeight;
              }
              if (d.type === 'done') {
                if (doneHandled) continue;
                doneHandled = true;
                donePayload = d;
                if (donePayload && donePayload.reply) {
                  donePayload.reply = normalizeKellyCheckoutReply(donePayload.reply);
                }
                if (assistantEl && d.reply && !assistantEl.textContent.trim()) {
                  assistantEl.textContent = String(d.reply).trim();
                }
                if (!assistantEl && d.reply) {
                  appendChatBubble('assistant', String(d.reply).trim());
                }
              }
              if (d.type === 'error') {
                throw new Error(d.error || 'Stream error');
              }
            }
          }
          removeTypingIndicator();
          if (assistantEl) {
            assistantEl.classList.remove('cc-msg-streaming');
          }
          var assistantTextDone = assistantEl ? String(assistantEl.textContent || '').trim() : '';
          if (donePayload && donePayload.reply && !assistantTextDone) {
            assistantTextDone = String(donePayload.reply).trim();
          }
          if (assistantEl && assistantTextDone) {
            assistantEl.innerHTML = formatAssistantMessageHtml(assistantTextDone);
          }
          if (assistantTextDone) {
            maybeShowConversionChip(assistantTextDone);
            maybeShowTurnNudgeStrip();
          }
          setComposerStatus('', '');
          if (donePayload) {
            applyStageContract(donePayload);
            appendStructuredUiFromPayload(donePayload);
          }
          if (donePayload && donePayload.quote_id) {
            quoteId = String(donePayload.quote_id);
            emitFunnelEvent('quote_shown', { product_id: currentProductId, quote_id: quoteId });
            fetchQuote();
          } else if (donePayload && Array.isArray(donePayload.toolsUsed) && donePayload.toolsUsed.indexOf('get_product_quote') >= 0) {
            fetchQuote();
          }
          if (donePayload && Array.isArray(donePayload.toolsUsed)) {
            const hasCartMutation = donePayload.toolsUsed.some(function (t) {
              return ['add_to_cart', 'update_cart_item', 'remove_cart_item', 'clear_cart'].indexOf(String(t)) >= 0;
            });
            if (hasCartMutation) {
              refreshCart().catch(function () {});
              appendChatBubble('assistant', 'Anything else you want to add before checkout?');
            }
          }
          if (donePayload && donePayload.redirect_to) {
            emitFunnelEvent('chat_commerce_redirect_ready', { product_id: currentProductId });
            if (donePayload.policy_flags && donePayload.policy_flags.can_show_payment_form) {
              setCheckoutStage('payment');
            }
          }
        } catch (e) {
          clearTimeout(to);
          removeTypingIndicator();
          setComposerStatus('', '');
          try {
            const chatPath = sid ? '/api/patient/checkout-chat/turn' : '/api/public/checkout-chat/turn';
            const res2 = await fetch(API_BASE + chatPath, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-session-id': effectiveSessionHeader,
                'ngrok-skip-browser-warning': 'true'
              },
              body: JSON.stringify({
                message: t,
                product_id: currentProductId,
                provider_id: merchantId,
                session_id: ensureKellySessionId()
              })
            });
            const data = await res2.json();
            if (res2.ok && data.success) {
              const reply = (data.reply != null && String(data.reply).trim())
                ? normalizeKellyCheckoutReply(String(data.reply).trim())
                : KELLY_COPY.fallbackReply;
              if (assistantEl && assistantEl.parentNode) {
                assistantEl.classList.remove('cc-msg-streaming');
                var prev = String(assistantEl.textContent || '').trim();
                if (prev.length > 0 && prev !== reply) {
                  appendChatBubble('assistant', reply);
                } else {
                  assistantEl.innerHTML = formatAssistantMessageHtml(reply);
                }
              } else {
                appendChatBubble('assistant', reply);
              }
              maybeShowConversionChip(reply);
              maybeShowTurnNudgeStrip();
              setComposerStatus('', '');
              applyStageContract(data);
              appendStructuredUiFromPayload(data);
              if (data.quote_id) {
                quoteId = String(data.quote_id);
                emitFunnelEvent('quote_shown', { product_id: currentProductId, quote_id: quoteId });
                fetchQuote();
              } else if (Array.isArray(data.toolsUsed) && data.toolsUsed.indexOf('get_product_quote') >= 0) {
                fetchQuote();
              }
              if (Array.isArray(data.toolsUsed)) {
                const hasCartMutation2 = data.toolsUsed.some(function (t) {
                  return ['add_to_cart', 'update_cart_item', 'remove_cart_item', 'clear_cart'].indexOf(String(t)) >= 0;
                });
                if (hasCartMutation2) {
                  refreshCart()
                    .then(function () {
                      updateInThreadPayUI();
                    })
                    .catch(function () {});
                  appendChatBubble('assistant', 'Anything else you want to add before checkout?');
                }
              }
              if (data.commerce_checkout) {
                applyCommerceCheckoutFromPayload(data.commerce_checkout);
              }
              if (data.redirect_to) {
                if (data.policy_flags && data.policy_flags.can_show_payment_form) {
                  setCheckoutStage('payment');
                }
              }
              return;
            }
          } catch (_) {}
          if (assistantEl && assistantEl.parentNode) {
            assistantEl.remove();
            assistantEl = null;
          }
          appendAssistantErrorCard(KELLY_COPY.errorConnectionAssistant);
          setComposerStatus('', '');
        } finally {
          removeTypingIndicator();
          if (btnSendChat) btnSendChat.disabled = false;
          updateChatEmptyState();
        }
      }

      if (btnSendChat) {
        btnSendChat.addEventListener('click', sendKellyMessage);
      }

      // Popup nudge interactions are intentionally disabled in chat-only checkout.

      const btnProductSwitch = document.getElementById('btnProductSwitch');
      const productSheetBackdrop = document.getElementById('productSheetBackdrop');
      if (btnProductSwitch) {
        btnProductSwitch.addEventListener('click', function () {
          openProductSheet();
        });
      }
      if (productSheetBackdrop) {
        productSheetBackdrop.addEventListener('click', function () {
          closeProductSheet();
        });
      }
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeProductSheet();
      });

      const btnSwitchCancel = document.getElementById('btnSwitchCancel');
      const btnSwitchConfirm = document.getElementById('btnSwitchConfirm');
      if (btnSwitchCancel) {
        btnSwitchCancel.addEventListener('click', function () {
          const list = document.getElementById('productSheetList');
          const conf = document.getElementById('productSwitchConfirm');
          pendingSwitchProduct = null;
          if (list) list.classList.remove('hidden');
          if (conf) conf.classList.add('hidden');
        });
      }
      if (btnSwitchConfirm) {
        btnSwitchConfirm.addEventListener('click', function () {
          const chk = document.getElementById('chkSkipSwitchConfirm');
          if (chk && chk.checked) {
            try {
              sessionStorage.setItem('cc_skip_product_switch_confirm', '1');
            } catch (_) {}
          }
          const p = pendingSwitchProduct;
          pendingSwitchProduct = null;
          const list = document.getElementById('productSheetList');
          const conf = document.getElementById('productSwitchConfirm');
          if (list) list.classList.remove('hidden');
          if (conf) conf.classList.add('hidden');
          if (p) {
            switchProduct(String(p.id));
          }
          closeProductSheet();
        });
      }

      const composerForEnter = document.getElementById('composer');
      if (composerForEnter) {
        composerForEnter.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendKellyMessage();
          }
        });
      }

      const btnPayInThread = document.getElementById('btnPayInThread');
      if (btnPayInThread) {
        try { window.openPayConfirmationModal = openPayConfirmationModal; } catch (_) {}
        btnPayInThread.addEventListener('click', function () {
          if (!product || btnPayInThread.disabled) return;
          markJourneyFlag('checkoutStarted', true);
          journeyType = 'checkout_returning';
          emitFunnelEvent('in_chat_pay_tap', {
            product_id: currentProductId,
            quote_id: quoteId || undefined
          });
          openPayConfirmationModal();
        });
      }

      function closePayModal() {
        if (inlinePayConfirm) inlinePayConfirm.classList.add('hidden');
        setCheckoutStage('shipping');
        focusPrimaryCheckoutControl();
      }

      if (payCancel) payCancel.addEventListener('click', closePayModal);

      if (btnPay) btnPay.addEventListener('click', async function () {
        // Keep the legacy inline pay card aligned with the chat-native checkout flow.
        if (inlinePayConfirm) inlinePayConfirm.classList.add('hidden');
        try {
          emitFunnelEvent('manual_checkout_click', {
            product_id: currentProductId,
            quote_id: quoteId || undefined,
            source: 'inline_stripe_modal'
          });
        } catch (_) {}
        openPayConfirmationModal();
      });

      if (btnClearCart) {
        btnClearCart.addEventListener('click', async function () {
          try {
            await postCart('/api/public/commerce/cart/clear', {});
            cartState = { items: [], subtotal: 0, item_count: 0 };
            renderCart();
            quoteId = '';
            lastQuotedAmount = null;
            checkoutIntent = false;
            markJourneyFlag('checkoutStarted', false);
            markJourneyFlag('quoteReady', false);
            journeyType = resolveJourneyType();
            clearCheckoutFlowStage();
            if (inlinePayConfirm) inlinePayConfirm.classList.add('hidden');
            applyUiMode('learn', 'cart_cleared');
            updateInThreadPayUI();
          } catch (_) {}
        });
      }

      if (cartItemsEl) {
        cartItemsEl.addEventListener('click', async function (e) {
          if (isCartQuantityLocked()) return;
          const btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
          if (!btn) return;
          const row = btn.closest('.cc-cart-item');
          const productId = row && row.getAttribute('data-product-id');
          if (!productId) return;
          const item = (cartState.items || []).find((it) => String(it.product_id) === String(productId));
          if (!item) return;
          try {
            const action = btn.getAttribute('data-action');
            if (action === 'inc') {
              await postCart('/api/public/commerce/cart/update', { product_id: productId, quantity: Number(item.quantity || 0) + 1 });
            } else if (action === 'dec') {
              await postCart('/api/public/commerce/cart/update', { product_id: productId, quantity: Number(item.quantity || 0) - 1 });
            } else if (action === 'remove') {
              await postCart('/api/public/commerce/cart/remove', { product_id: productId });
            }
            await refreshCart();
          } catch (err) {
            if (err && (err.code === 'cart_locked' || err.status === 409)) {
              await refreshCart().catch(function () {});
              if (typeof window.showPatientAlert === 'function') {
                window.showPatientAlert({
                  type: 'error',
                  message: 'Checkout is locked while payment is in progress. Confirm your email code to continue.'
                });
              }
            }
          }
        });
      }
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
          if (uiMode === 'checkout') void syncCheckoutContractFromServer();
        }
      });
      window.addEventListener('focus', function () {
        if (uiMode === 'checkout') void syncCheckoutContractFromServer();
      });

      try {
        if (typeof window !== 'undefined' && String(window.location.search || '').indexOf('cc_test_hooks=1') >= 0) {
          window.__CC_CHECKOUT_TEST__ = { lockPaymentBubbleAfterSuccess: lockPaymentBubbleAfterSuccess };
        }
      } catch (_) {}
    })();
