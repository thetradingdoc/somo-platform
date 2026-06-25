/**
 * Parity with web `checkout-chat.html` `emitFunnelEvent` / `dataLayer`:
 * - Ring buffer for debugging and E2E assertions (`getCheckoutAnalyticsBuffer()`).
 * - `DeviceEventEmitter` event `checkout-funnel` with `{ name, ...detail }` (same shape as web CustomEvent).
 * - Optional sink: `globalThis.__checkoutAnalyticsSink?.(name, detail)` for production wiring (Segment, etc.).
 */
import { DeviceEventEmitter } from 'react-native';

export type CheckoutAnalyticsDetail = Record<string, unknown>;

const BUFFER_MAX = 80;
const buffer: { event: string; detail?: CheckoutAnalyticsDetail; ts: number }[] = [];

function pushBuffer(event: string, detail?: CheckoutAnalyticsDetail) {
  buffer.push({ event, detail, ts: Date.now() });
  while (buffer.length > BUFFER_MAX) buffer.shift();
}

export function getCheckoutAnalyticsBuffer() {
  return buffer.slice();
}

export function clearCheckoutAnalyticsBuffer() {
  buffer.length = 0;
}

export function emitCheckoutAnalytics(name: string, detail?: CheckoutAnalyticsDetail) {
  pushBuffer(name, detail);
  try {
    DeviceEventEmitter.emit('checkout-funnel', { name, ...(detail || {}) });
  } catch {
    /* ignore */
  }
  try {
    const sink = (globalThis as { __checkoutAnalyticsSink?: (n: string, d?: CheckoutAnalyticsDetail) => void })
      .__checkoutAnalyticsSink;
    if (typeof sink === 'function') sink(name, detail);
  } catch {
    /* ignore */
  }
  if (__DEV__) {
    try {
      console.log('[checkout-analytics]', JSON.stringify({ event: name, ...detail }));
    } catch {
      /* ignore */
    }
  }
}
