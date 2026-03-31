const { test, expect } = require('@playwright/test');

const base = (process.env.CHECKOUT_E2E_BASE_URL || '').replace(/\/$/, '');

test.describe('kelly conversational checkout journey', () => {
  test.skip(!base, 'Set CHECKOUT_E2E_BASE_URL (e.g. http://127.0.0.1:4000)');

  test('chat -> quote -> cart mutation -> payment handoff', async ({ page }) => {
    const productId = 'prod-retinol-peptide-night-serum';
    const providerId = 'merchant_c3d547a10f43eeec';

    // Prevent navigation hangs on blocked external fonts.
    await page.route('https://fonts.googleapis.com/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
    await page.route('https://fonts.gstatic.com/**', async (route) => {
      await route.abort();
    });

    // Ensure the page talks to the same instance/port as `base`.
    // The checkout page defaults API_BASE to localhost:4000 if window.API_BASE isn't set.
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
      stripeHandoff: 0,
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
              image_url: '/images/products/retinol-brightening-night-serum.png',
            },
          ],
          prescriptions: [],
          count: 1,
          provider_id: providerId,
          merchant_id: providerId,
        }),
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
                      total: 29.99 * cartQty,
                    },
                  ]
                : [],
            subtotal: 29.99 * cartQty,
            item_count: cartQty,
          },
        }),
      });
    });

    await page.route('**/api/public/commerce/cart/add', async (route) => {
      seen.cartAdd += 1;
      cartQty += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
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
          payment_action: { type: 'payment_link', url: 'https://example.test/pay/pi_test_001' },
        }),
      });
    });

    // config.js fetches tenant config asynchronously; ensure deterministic response.
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
      // Current backend does not provide a public SSE stream endpoint; UI should gracefully fall back.
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'stream_not_available' }),
      });
    });

    await page.route('**/api/public/checkout-chat/turn', async (route) => {
      seen.chatTurnFallback += 1;
      cartQty = 1; // Simulate server-side cart mutation performed by Kelly tools.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          reply: 'Great choice. I added it to your cart and locked your quote.',
          quote_id: 'q_test_001',
          toolsUsed: ['get_product_quote', 'add_to_cart'],
        }),
      });
    });

    await page.route('**/api/public/commerce/stripe-config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, publishable_key: 'pk_test_mock' }),
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
        `,
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
            payment_link: null,
          },
        }),
      });
    });

    await page.route('**/api/public/checkout/start', async (route) => {
      // Fallback payment path; if this is called, still allow handoff.
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
            payment_link: null,
          },
        }),
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
          amount: 29.99,
        }),
      });
    });

    const q = new URLSearchParams({
      source: 'landing',
      intent: 'checkout_chat',
      product_id: productId,
      provider_id: providerId,
      bridge: '0',
      cart_bootstrap: '0',
      product_name: 'Retinol Brightening Night Serum',
    });

    await page.goto(`${base}/unified-dashboard/patients/checkout-chat.html?${q.toString()}`, {
      waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#productTitle')).toContainText('Retinol Brightening Night Serum');
    await expect(page.locator('#composer')).toBeVisible();

    await page.fill('#composer', 'Add this to my cart and let me check out.');
    await page.click('#btnSendChat');

    await expect(page.locator('#chatLog')).toContainText('Great choice. I added it to your cart');
    await expect(page.locator('#productPrice')).toContainText('$29.99');
    await expect(page.locator('#cartSubtotal')).toContainText('$29.99');

    // Checkout intent from landing: pay CTA appears in-thread after quote + cart (no learn-mode chip required).
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

    // Capability assessment assertions for this test:
    expect(seen.products).toBeGreaterThan(0);
    expect(seen.chatStream).toBeGreaterThan(0);
    expect(seen.chatTurnFallback).toBeGreaterThan(0);
    expect(seen.quote).toBeGreaterThan(0);
    expect(seen.cartRead).toBeGreaterThan(0);
    // Cart mutation may happen server-side via Kelly tools (no direct /cart/add call from browser).
    expect(seen.cartAdd > 0 || cartQty > 0).toBeTruthy();
    expect(seen.cartCheckout + seen.checkoutStart).toBeGreaterThan(0);
    expect(seen.stripeHandoff).toBeGreaterThan(0);
  });
});

