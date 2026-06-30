import { useCallback, useEffect, useState } from 'react';
import { fetchRouting, startCopayRoute, mockPayCopay, requestEligibilityQuote } from '../lib/healthSessionApi.js';
import BtnPrimary from './brand/BtnPrimary.jsx';

export default function CopayPanel({ sessionId, sessionToken, enabled = true }) {
  const [routing, setRouting] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !sessionId || !sessionToken) return;
    try {
      let data = await fetchRouting(sessionId, sessionToken);
      if (!data?.copay_cents && data?.payment_status === 'none') {
        data = await requestEligibilityQuote(sessionId, sessionToken, {});
      }
      setRouting(data);
    } catch (e) {
      setError(e.message);
    }
  }, [enabled, sessionId, sessionToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!enabled || !routing?.copay_cents || routing.payment_status === 'paid') {
    return null;
  }

  const handleQuote = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await startCopayRoute(sessionId, sessionToken, {});
      setRouting(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMockPay = async () => {
    setPaying(true);
    setError('');
    try {
      const data = await mockPayCopay(sessionId, sessionToken);
      setRouting(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setPaying(false);
    }
  };

  const showMockPay = routing.mock_payment || routing.payment_status === 'pending_mock';

  return (
    <aside className="hv-copay-panel" data-testid="health-copay-panel" aria-live="polite">
      <div className="hv-copay-panel-inner">
        <strong>Est. copay {routing.copay_display || `$${(routing.copay_cents / 100).toFixed(2)}`}</strong>
        <p className="hv-copay-copy">
          {routing.network_status === 'in_network'
            ? 'In-network estimate · Pay to confirm your visit route'
            : 'Copay estimate · Pay to confirm'}
        </p>
        {error && <p className="hv-copay-error" role="alert">{error}</p>}
        {!showMockPay && routing.payment_status === 'quoted' && (
          <BtnPrimary className="hv-copay-btn" onClick={handleQuote} disabled={loading}>
            {loading ? 'Preparing checkout…' : 'Pay to confirm'}
          </BtnPrimary>
        )}
        {showMockPay && (
          <BtnPrimary className="hv-copay-btn" onClick={handleMockPay} disabled={paying}>
            {paying ? 'Confirming…' : 'Confirm copay (demo)'}
          </BtnPrimary>
        )}
        {routing.payment_status === 'pending' && routing.client_secret && (
          <p className="hv-copay-copy">Stripe checkout ready — complete payment in the hosted flow.</p>
        )}
      </div>
    </aside>
  );
}
