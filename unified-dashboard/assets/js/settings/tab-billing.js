window.SettingsPage = window.SettingsPage || {};
const SP = window.SettingsPage;
        function viewPlans() {
            const tier = (SP.currentCustomer?.plan_tier || SP.currentCustomer?.pricing_tier || 'starter').toLowerCase();
            const tierLabels = { starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise', basic: 'Basic' };
            const label = tierLabels[tier] || tier;
            alert(`Your plan: ${label}\n\nYour current tier is stored in your account. Contact support to upgrade or change your plan.`);
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

                    // Update payment method display
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
                    // Redirect to Stripe checkout
                    window.location.href = data.checkout_url;
                } else {
                    alert('Failed to create checkout session: ' + (data.error || 'Unknown error'));
                }
            } catch (error) {
                console.error('Setup payment method error:', error);
                alert('Failed to setup payment method. Please try again.');
            }
        }

        // Initialize on page load
        document.addEventListener('DOMContentLoaded', () => {
            loadBillingUsage();

            // Check for payment success/cancel in URL
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('payment') === 'success') {
                alert('✅ Payment method added successfully!');
                loadBillingUsage();
                window.history.replaceState({}, document.title, window.location.pathname);
            } else if (urlParams.get('payment') === 'cancelled') {
                alert('Payment setup was cancelled.');
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        });
window.viewPlans = viewPlans;
window.viewInvoices = viewInvoices;
window.showInvoicesModal = showInvoicesModal;
window.paymentMethodAction = paymentMethodAction;
window.updatePaymentMethod = updatePaymentMethod;
window.loadBillingUsage = loadBillingUsage;
window.setupPaymentMethod = setupPaymentMethod;