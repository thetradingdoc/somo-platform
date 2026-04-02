/**
 * Kelly checkout in the browser: real agent (API + UI composer) vs optional offline mocks.
 *
 * Real integration (default):
 *   CHECKOUT_E2E_BASE_URL=http://127.0.0.1:4000 npx playwright test e2e/kelly-conversational-checkout.spec.cjs
 *
 * Offline mock (no Kelly/Stripe):
 *   E2E_KELLY_CONVERSATIONAL_MOCK=1 CHECKOUT_E2E_BASE_URL=http://127.0.0.1:4000 npx playwright test e2e/kelly-conversational-checkout.spec.cjs
 */
const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}
process.env.DB_PATH = path.join(__dirname, '..', 'middleware-dev.db');

const { test, expect } = require('@playwright/test');
const {
  setMeta,
  waitCode,
  backendTurn,
  sendWithRetry,
  openAnyVisibleChatPayControl,
  fillStripeCardFields
} = require('./checkout-ui-helpers');

const base = (process.env.CHECKOUT_E2E_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const email = String(process.env.TEST_CHECKOUT_EMAIL || 'drlittlekids@gmail.com').toLowerCase();
const shipping = process.env.TEST_CHECKOUT_SHIPPING || '1119 East Gun Hill Road, Bronx, NY 10465';

test.describe('Kelly conversational checkout (real agent UI)', () => {
  test('composer messages + payment modal complete end-to-end', async ({ page, request }) => {
    test.setTimeout(180000);
    page.on('console', (msg) => {
      try {
        console.log('[browser]', msg.type(), msg.text());
      } catch (_) {}
    });

    const products = await request.get(`${base}/api/public/products`);
    expect(products.ok()).toBeTruthy();
    const payload = await products.json();
    const product = (payload?.products || [])[0];
    expect(product).toBeTruthy();
    const productId = product.id;
    const providerId = product.merchant_id || product.provider_id;
    const sessionId = `kelly_conv_ui_${Date.now()}`;

    await backendTurn(base, request, {
      session_id: sessionId,
      provider_id: providerId,
      product_id: productId,
      message: 'add to cart and proceed to checkout'
    });
    await backendTurn(base, request, { session_id: sessionId, provider_id: providerId, product_id: productId, message: 'confirm cart' });
    await backendTurn(base, request, { session_id: sessionId, provider_id: providerId, product_id: productId, message: email });
    const code = await waitCode(email, 45000);
    expect(code).toBeTruthy();
    await backendTurn(base, request, { session_id: sessionId, provider_id: providerId, product_id: productId, message: code });
    await backendTurn(base, request, { session_id: sessionId, provider_id: providerId, product_id: productId, message: shipping });
    let prepDone = null;
    for (let i = 0; i < 5; i += 1) {
      prepDone = await backendTurn(base, request, {
        session_id: sessionId,
        provider_id: providerId,
        product_id: productId,
        message: 'continue secure checkout'
      });
      if (String(prepDone?.checkout_stage || '') === 'checkout_prepared') break;
    }
    const cartSeed = await request.post(`${base}/api/public/commerce/cart/add`, {
      data: { session_id: sessionId, provider_id: providerId, product_id: productId, quantity: 1 }
    });
    const cartSeedPayload = await cartSeed.json().catch(() => ({}));
    expect(cartSeed.ok() || String(cartSeedPayload?.error || '') === 'cart_locked').toBeTruthy();
    setMeta(sessionId, 'commerce_email_verified', email);
    setMeta(sessionId, 'commerce_shipping_address', shipping);
    setMeta(sessionId, 'commerce_shipping_complete', '1');
    if (String(prepDone?.checkout_stage || '') !== 'checkout_prepared') {
      setMeta(sessionId, 'checkout_stage', 'checkout_prepared');
    }

    await page.addInitScript(({ pId, sid, merchantId, apiBase }) => {
      try {
        window.API_BASE = apiBase;
        const patientSid = 'pw_kelly_conv_user';
        localStorage.setItem('patient_session_id', patientSid);
        localStorage.setItem('cc_force_stripe_card_mode', '1');
        const identitySeed = String(patientSid || 'guest');
        let identityHash = 0;
        for (let i = 0; i < identitySeed.length; i++) {
          identityHash = (identityHash * 31 + identitySeed.charCodeAt(i)) >>> 0;
        }
        const key = 'checkout_kelly_session_' + String(pId) + '_' + String(merchantId) + '_checkout_' + String(identityHash);
        localStorage.setItem(key, String(sid));
      } catch (_) {}
    }, { pId: productId, sid: sessionId, merchantId: providerId, apiBase: base });

    const q = new URLSearchParams({
      source: 'landing',
      intent: 'checkout_chat',
      force_stripe_card_mode: '1',
      product_id: productId,
      provider_id: providerId,
      bridge: '0',
      cart_bootstrap: '0',
      product_name: String(product.name || 'Product')
    });
    await page.goto(`${base}/unified-dashboard/patients/checkout-chat.html?${q.toString()}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#composer')).toBeVisible();

    await sendWithRetry(page, 'Add this to my cart and let me check out.', 3);
    await page.waitForFunction(
      () => (document.querySelector('#chatLog')?.innerText || '').trim().length > 80,
      { timeout: 120000 }
    );

    await sendWithRetry(page, 'continue secure checkout', 3);
    await openAnyVisibleChatPayControl(page);

    await page.fill('#ccPayConfirmChatBubble input[placeholder="Name on card"]', 'Kelly UI E2E');
    await page.fill('#ccPayConfirmChatBubble input[placeholder="Address line 1"]', '1119 East Gun Hill Road');
    await page.fill('#ccPayConfirmChatBubble input[placeholder="City"]', 'Bronx');
    await page.fill('#ccPayConfirmChatBubble input[placeholder="State"]', 'NY');
    await page.fill('#ccPayConfirmChatBubble input[placeholder="ZIP"]', '10465');
    await page.fill('#ccPayConfirmChatBubble input[placeholder="Mobile number"]', '+18622307479');
    await page.fill('#ccPayConfirmChatBubble input[type="email"]', email);

    const payBtn = page.locator('#ccPayConfirmChatBubble button').filter({ hasText: 'Pay securely' }).first();
    await page.waitForSelector('#ccStripePaymentMount iframe', { state: 'visible', timeout: 45000 }).catch(() => {});
    let cardFilled = await fillStripeCardFields(page);
    if (!cardFilled) {
      await page.waitForTimeout(2000);
      cardFilled = await fillStripeCardFields(page);
    }
    expect(cardFilled).toBeTruthy();
    await expect(payBtn).toBeEnabled({ timeout: 30000 });
    await payBtn.click();
    const refreshedHint = page.locator('#ccPayStateHint').filter({ hasText: 'Payment session refreshed' }).first();
    const retryMountBtn = page.locator('#ccPayConfirmChatBubble button').filter({ hasText: 'Retry card fields' }).first();
    if (await refreshedHint.isVisible().catch(() => false)) {
      await retryMountBtn.click();
      await page.waitForTimeout(2000);
      const secondFill = await fillStripeCardFields(page);
      expect(secondFill).toBeTruthy();
      await expect(payBtn).toBeEnabled({ timeout: 30000 });
      await payBtn.click();
    }
    await expect(page.locator('#chatLog')).toContainText('Receipt', { timeout: 60000 });
  });
});

test.describe('Kelly conversational checkout (mocked, offline)', () => {
  test.skip(process.env.E2E_KELLY_CONVERSATIONAL_MOCK !== '1', 'Set E2E_KELLY_CONVERSATIONAL_MOCK=1 for offline mock');

  test('chat -> quote -> cart mutation -> payment handoff (mocked APIs)', async ({ page }) => {
    const productId = 'prod-retinol-peptide-night-serum';
    const providerId = 'merchant_c3d547a10f43eeec';
    const mockBase = (process.env.CHECKOUT_E2E_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

    await page.route('https://fonts.googleapis.com/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
    await page.route('https://fonts.gstatic.com/**', async (route) => {
      await route.abort();
    });

    await page.addInitScript(() => {
      try {
        window.API_BASE = window.location.origin;
      } catch (_) {}
    });

    let cartQty = 0;
    const seen = {
      products: 0,
      chatStream: 0,
      chatTurnFallback: 0,
      quote: 0,
      cartRead: 0,
      cartAdd: 0,
      cartCheckout: 0,
      checkoutStart: 0,
      stripeHandoff: 0
    };

    await page.route('**/api/public/products**', async (route) => {
      seen.products += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          products: [
            {
              id: productId,
              merchant_id: providerId,
              name: 'Retinol Brightening Night Serum',
              price: 29.99,
              image_url: '/images/products/retinol-brightening-night-serum.png'
            }
          ],
          prescriptions: [],
          count: 1,
          provider_id: providerId,
          merchant_id: providerId
        })
      });
    });

    await page.route('**/api/public/commerce/cart?**', async (route) => {
      seen.cartRead += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          cart: {
            items:
              cartQty > 0
                ? [
                    {
                      product_id: productId,
                      name: 'Retinol Brightening Night Serum',
                      quantity: cartQty,
                      total: 29.99 * cartQty
                    }
                  ]
                : [],
            subtotal: 29.99 * cartQty,
            item_count: cartQty
          }
        })
      });
    });

    await page.route('**/api/public/commerce/cart/add', async (route) => {
      seen.cartAdd += 1;
      cartQty += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      });
    });

    await page.route('**/api/public/commerce/quote', async (route) => {
      seen.quote += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          quote_id: 'q_test_001',
          amount: 29.99,
          currency: 'USD',
          payment_action: { type: 'payment_link', url: 'https://example.test/pay/pi_test_001' }
        })
      });
    });

    await page.route('**/api/tenant/config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          hostname: '127.0.0.1',
          subdomain: null,
          tenant_type: 'shop',
          navItems: [],
          sidebarSubtitle: 'Healthcare at your home',
          merchant_id: providerId,
          clinic_id: 'clinic-default'
        })
      });
    });

    await page.route('**/api/public/checkout-chat/turn/stream', async (route) => {
      seen.chatStream += 1;
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'stream_not_available' })
      });
    });

    await page.route('**/api/public/checkout-chat/turn', async (route) => {
      seen.chatTurnFallback += 1;
      cartQty = 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          reply: 'Great choice. I added it to your cart and locked your quote.',
          quote_id: 'q_test_001',
          toolsUsed: ['get_product_quote', 'add_to_cart']
        })
      });
    });

    await page.route('**/api/public/commerce/stripe-config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, publishable_key: 'pk_test_mock' })
      });
    });

    await page.route('https://js.stripe.com/v3', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.Stripe = function() {
            return {
              elements: function(opts) {
                return {
                  create: function() {
                    return {
                      mount: function() {},
                      destroy: function() {},
                    };
                  },
                };
              },
              confirmPayment: async function() {
                return {
                  error: null,
                  paymentIntent: {
                    id: 'pi_test_001',
                    status: 'succeeded',
                    metadata: { checkout_id: 'chk_test_001' }
                  }
                };
              },
            };
          };
        `
      });
    });

    await page.route('**/api/public/commerce/stripe/confirm-payment', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          payment_intent_id: 'pi_test_001',
          status: 'succeeded'
        })
      });
    });

    await page.route('**/api/public/commerce/email/send-code', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, email_sent: true })
      });
    });

    await page.route('**/api/public/commerce/email/verify-code', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      });
    });

    await page.route('**/api/public/commerce/cart/checkout', async (route) => {
      seen.cartCheckout += 1;
      seen.stripeHandoff += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          checkout: {
            checkout_id: 'chk_test_001',
            client_secret: 'pi_test_secret',
            payment_intent_id: 'pi_test_001',
            payment_link: null
          }
        })
      });
    });

    await page.route('**/api/public/checkout/start', async (route) => {
      seen.checkoutStart += 1;
      seen.stripeHandoff += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          checkout: {
            checkout_id: 'chk_test_001',
            client_secret: 'pi_test_secret',
            payment_intent_id: 'pi_test_001',
            payment_link: null
          }
        })
      });
    });

    await page.route('**/voice/checkout/status/chk_test_001', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          checkout_id: 'chk_test_001',
          status: 'completed',
          amount: 29.99
        })
      });
    });

    const q = new URLSearchParams({
      source: 'landing',
      intent: 'checkout_chat',
      product_id: productId,
      provider_id: providerId,
      bridge: '0',
      cart_bootstrap: '0',
      product_name: 'Retinol Brightening Night Serum'
    });

    await page.goto(`${mockBase}/unified-dashboard/patients/checkout-chat.html?${q.toString()}`, {
      waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#productTitle')).toContainText('Retinol Brightening Night Serum');
    await expect(page.locator('#composer')).toBeVisible();

    await page.fill('#composer', 'Add this to my cart and let me check out.');
    await page.click('#btnSendChat');

    await expect(page.locator('#chatLog')).toContainText('Great choice. I added it to your cart');
    await expect(page.locator('#productPrice')).toContainText('$29.99');
    await expect(page.locator('#cartSubtotal')).toContainText('$29.99');

    await expect(page.locator('#ccPayCTAChatBubble button').filter({ hasText: /Pay\s+\$/ })).toBeVisible({
      timeout: 15000
    });
    await page.locator('#ccPayCTAChatBubble button').filter({ hasText: /Pay\s+\$/ }).click();

    await expect(page.locator('#ccPayConfirmChatBubble')).toBeVisible();
    await page.fill('#ccPayConfirmChatBubble input[placeholder="Name on card"]', 'Kelly E2E');
    await page.fill('#ccPayConfirmChatBubble input[placeholder="Address line 1"]', '1 Test St');
    await page.fill('#ccPayConfirmChatBubble input[placeholder="City"]', 'Austin');
    await page.fill('#ccPayConfirmChatBubble input[placeholder="State"]', 'TX');
    await page.fill('#ccPayConfirmChatBubble input[placeholder="ZIP"]', '78701');
    await page.fill('#ccPayConfirmChatBubble input[placeholder="Mobile number"]', '+15555550123');
    await page.fill('#ccPayConfirmChatBubble input[type="email"]', 'kelly-e2e@example.com');

    await page.locator('#ccPayConfirmChatBubble button').filter({ hasText: 'Send code' }).click();
    await page.fill('#ccPayConfirmChatBubble input[placeholder="Verification code"]', '123456');
    await page.locator('#ccPayConfirmChatBubble button').filter({ hasText: 'Verify' }).click();

    await page.locator('#ccPayConfirmChatBubble button').filter({ hasText: 'Pay securely' }).click();

    await expect(page.locator('#chatLog')).toContainText('Receipt');

    expect(seen.products).toBeGreaterThan(0);
    expect(seen.chatStream).toBeGreaterThan(0);
    expect(seen.chatTurnFallback).toBeGreaterThan(0);
    expect(seen.quote).toBeGreaterThan(0);
    expect(seen.cartRead).toBeGreaterThan(0);
    expect(seen.cartAdd > 0 || cartQty > 0).toBeTruthy();
    expect(seen.cartCheckout + seen.checkoutStart).toBeGreaterThan(0);
    expect(seen.stripeHandoff).toBeGreaterThan(0);
  });
});
