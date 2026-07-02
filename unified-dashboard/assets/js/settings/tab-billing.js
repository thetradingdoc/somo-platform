window.SettingsPage = window.SettingsPage || {};
const SP = window.SettingsPage;

        function formatUsd(amount) {
            const n = Number(amount);
            if (!Number.isFinite(n)) return '—';
            return `$${n.toFixed(0)}/mo`;
        }

        function closePlansModal() {
            const el = document.getElementById('voicePlansModalOverlay');
            if (el) el.remove();
        }

        async function startSubscriptionCheckout(tierId) {
            const res = await fetch(`${SP.API_BASE}/api/voice-billing/checkout/subscription`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tier: tierId })
            });
            const data = await res.json();
            if (!data.success || !data.url) {
                throw new Error(data.error || 'Failed to start checkout');
            }
            window.location.href = data.url;
        }

        async function startTopupCheckout(packId) {
            const res = await fetch(`${SP.API_BASE}/api/voice-billing/checkout/topup`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pack_id: packId })
            });
            const data = await res.json();
            if (!data.success || !data.url) {
                throw new Error(data.error || 'Failed to start top-up checkout');
            }
            window.location.href = data.url;
        }

        async function viewPlans() {
            try {
                const [catalogRes, statusRes] = await Promise.all([
                    fetch(`${SP.API_BASE}/api/voice-billing/catalog`, { credentials: 'include' }),
                    fetch(`${SP.API_BASE}/api/voice-billing/status`, { credentials: 'include' })
                ]);
                const catalog = await catalogRes.json();
                const status = await statusRes.json();
                if (!catalog.success) throw new Error(catalog.error || 'Failed to load plans');

                const currentTier = (status.billing?.plan_tier || SP.currentCustomer?.plan_tier || 'starter').toLowerCase();
                const tiers = catalog.tiers || [];
                const topups = catalog.topup_packs || [];

                closePlansModal();
                const overlay = document.createElement('div');
                overlay.id = 'voicePlansModalOverlay';
                overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
                overlay.innerHTML = `
                    <div style="background:white;border-radius:12px;max-width:640px;width:100%;max-height:85vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);padding:24px;">
                        <h3 style="margin:0 0 8px 0;">Voice subscription plans</h3>
                        <p style="margin:0 0 16px 0;font-size:14px;color:var(--gray-600);">
                            Tax is calculated at checkout when Stripe Tax is enabled. Current plan: <strong>${currentTier}</strong>
                        </p>
                        <div style="display:grid;gap:12px;margin-bottom:20px;">
                            ${tiers.map((t) => `
                                <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
                                    <div>
                                        <div style="font-weight:600;">${t.name}</div>
                                        <div style="font-size:13px;color:var(--gray-600);">${t.included_minutes_per_cycle || 0} min / month</div>
                                        <div style="font-size:13px;color:var(--gray-600);">${formatUsd(t.monthly_price_usd)} + tax</div>
                                    </div>
                                    <button type="button" class="btn btn-primary btn-sm" data-tier="${t.id}" ${currentTier === t.id ? 'disabled' : ''}>
                                        ${currentTier === t.id ? 'Current' : 'Subscribe'}
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                        ${topups.length ? `
                            <h4 style="margin:0 0 8px 0;">Minute top-ups</h4>
                            <div style="display:grid;gap:8px;margin-bottom:16px;">
                                ${topups.map((p) => `
                                    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-top:1px solid #eee;">
                                        <span style="font-size:14px;">${p.name} — ${p.minutes} min ($${p.price_usd} + tax)</span>
                                        <button type="button" class="btn btn-secondary btn-sm" data-topup="${p.id}">Buy</button>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                        <button type="button" class="btn btn-secondary btn-sm" id="voicePlansCloseBtn">Close</button>
                    </div>
                `;
                overlay.onclick = (e) => { if (e.target === overlay) closePlansModal(); };
                overlay.querySelector('#voicePlansCloseBtn').onclick = closePlansModal;
                overlay.querySelectorAll('[data-tier]').forEach((btn) => {
                    btn.addEventListener('click', async () => {
                        btn.disabled = true;
                        try {
                            await startSubscriptionCheckout(btn.getAttribute('data-tier'));
                        } catch (e) {
                            alert(e.message || 'Checkout failed');
                            btn.disabled = false;
                        }
                    });
                });
                overlay.querySelectorAll('[data-topup]').forEach((btn) => {
                    btn.addEventListener('click', async () => {
                        btn.disabled = true;
                        try {
                            await startTopupCheckout(btn.getAttribute('data-topup'));
                        } catch (e) {
                            alert(e.message || 'Top-up checkout failed');
                            btn.disabled = false;
                        }
                    });
                });
                document.body.appendChild(overlay);
            } catch (e) {
                alert(e.message || 'Failed to load plans');
            }
        }

        async function viewInvoices() {
            try {
                const response = await fetch(`${SP.API_BASE}/api/customer/billing/invoices`, { credentials: 'include' });
                const data = await response.json();
                if (!data.success) throw new Error(data.error || 'Failed to load invoices');
                if (!data.invoices || data.invoices.length === 0) {
                    alert('No invoices yet. Invoices are generated monthly based on your usage.');
                    return;
                }
                showInvoicesModal(data.invoices);
            } catch (e) {
                alert(e.message || 'Failed to load invoices. Please try again.');
            }
        }

        function showInvoicesModal(invoices) {
            const existing = document.getElementById('invoicesModalOverlay');
            if (existing) existing.remove();
            const overlay = document.createElement('div');
            overlay.id = 'invoicesModalOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
            overlay.innerHTML = `
                <div style="background:white;border-radius:12px;max-width:520px;width:100%;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);padding:24px;">
                    <h3 style="margin:0 0 16px 0;">Invoices</h3>
                    <div style="font-size:14px;color:var(--gray-600);margin-bottom:16px;">
                        ${invoices.map(inv => `
                            <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee;">
                                <span>${inv.invoice_number || inv.id} — ${inv.billing_month || ''}</span>
                                <span><strong>$${(inv.total || 0).toFixed(2)}</strong> — ${inv.status || 'pending'}</span>
                            </div>
                        `).join('')}
                    </div>
                    <button onclick="document.getElementById('invoicesModalOverlay').remove()" class="btn btn-primary btn-sm">Close</button>
                </div>
            `;
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
            document.body.appendChild(overlay);
        }

        async function paymentMethodAction() {
            try {
                const portalRes = await fetch(`${SP.API_BASE}/api/customer/billing/portal`, {
                    method: 'POST',
                    credentials: 'include'
                });
                const portalData = await portalRes.json();
                if (portalData.success && portalData.url) {
                    window.location.href = portalData.url;
                    return;
                }
            } catch (_) {}
            setupPaymentMethod();
        }

        async function updatePaymentMethod() {
            paymentMethodAction();
        }

        async function loadVoiceBillingStatus() {
            const el = document.getElementById('voiceBillingPlanSummary');
            if (!el) return;
            try {
                const res = await fetch(`${SP.API_BASE}/api/voice-billing/status`, { credentials: 'include' });
                const data = await res.json();
                if (!data.success || !data.billing) {
                    el.textContent = 'Unable to load subscription status.';
                    return;
                }
                const b = data.billing;
                el.textContent = `Plan: ${b.plan_tier || 'starter'} · Status: ${b.subscription_status || 'unknown'} · Minutes remaining: ${b.minutes_remaining ?? '—'} · Eligibility: ${b.eligibility_checks_used ?? 0}/${b.included_eligibility_checks_per_cycle ?? '—'}`;
            } catch (_) {
                el.textContent = 'Unable to load subscription status.';
            }
        }

        async function loadBillingUsage() {
            try {
                const response = await fetch(`${SP.API_BASE}/api/customer/billing/usage`, {
                    credentials: 'include'
                });
                const data = await response.json();

                if (data.success) {
                    document.getElementById('usageVoiceMinutes').textContent = data.usage.voice_minutes || 0;
                    document.getElementById('usageCurrentCost').textContent = `$${data.costs.voice_cost.toFixed(2)}`;
                    document.getElementById('usageTotalCost').textContent = `$${data.costs.total.toFixed(2)}`;
                    document.getElementById('billingMonth').textContent = data.billing_month || '—';

                    if (data.payment_method.has_payment_method) {
                        document.getElementById('paymentMethodDesc').textContent =
                            `${data.payment_method.card_brand || 'Card'} •••• ${data.payment_method.card_last4 || ''}`;
                        document.getElementById('setupPaymentBtn').textContent = 'Update Payment Method';
                    } else {
                        document.getElementById('paymentMethodDesc').textContent = 'No payment method on file';
                        document.getElementById('setupPaymentBtn').textContent = 'Add Payment Method';
                    }
                } else {
                    console.error('Failed to load usage:', data.error);
                }
            } catch (error) {
                console.error('Load billing usage error:', error);
            }
        }

        async function setupPaymentMethod() {
            try {
                const response = await fetch(`${SP.API_BASE}/api/customer/billing/checkout`, {
                    method: 'POST',
                    credentials: 'include'
                });
                const data = await response.json();

                if (data.success && data.checkout_url) {
                    window.location.href = data.checkout_url;
                } else {
                    alert('Failed to create checkout session: ' + (data.error || 'Unknown error'));
                }
            } catch (error) {
                console.error('Setup payment method error:', error);
                alert('Failed to setup payment method. Please try again.');
            }
        }

        function handleBillingReturnParams() {
            const urlParams = new URLSearchParams(window.location.search);
            const billing = urlParams.get('billing');
            const topup = urlParams.get('topup');
            const payment = urlParams.get('payment');

            if (billing === 'success') {
                window.location.href = '/business/today.html?onboarding=checkout';
                return;
            } else if (billing === 'cancelled') {
                alert('Subscription checkout was cancelled.');
            } else if (topup === 'success') {
                alert('Top-up checkout completed. Minutes will be added after payment confirmation.');
                loadVoiceBillingStatus();
            } else if (topup === 'cancelled') {
                alert('Top-up checkout was cancelled.');
            } else if (payment === 'success') {
                alert('Payment method added successfully!');
                loadBillingUsage();
            } else if (payment === 'cancelled') {
                alert('Payment setup was cancelled.');
            }

            if (billing || topup || payment) {
                urlParams.delete('billing');
                urlParams.delete('topup');
                urlParams.delete('payment');
                const qs = urlParams.toString();
                const next = window.location.pathname + (qs ? `?${qs}` : '');
                window.history.replaceState({}, document.title, next);
            }

            if (billing || topup) {
                const tab = document.querySelector('[data-settings-tab="billing"]');
                if (tab) tab.click();
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            loadBillingUsage();
            loadVoiceBillingStatus();
            handleBillingReturnParams();
        });

window.viewPlans = viewPlans;
window.viewInvoices = viewInvoices;
window.showInvoicesModal = showInvoicesModal;
window.paymentMethodAction = paymentMethodAction;
window.updatePaymentMethod = updatePaymentMethod;
window.loadBillingUsage = loadBillingUsage;
window.setupPaymentMethod = setupPaymentMethod;
window.startSubscriptionCheckout = startSubscriptionCheckout;
window.startTopupCheckout = startTopupCheckout;
