/**
 * Parity with web checkout-chat: 429 retry + image URL resolution for catalog/degraded states.
 */

export async function fetchWith429Retry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { maxAttempts?: number; baseMs?: number }
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? 5;
  const baseMs = options?.baseMs ?? 350;
  let attempt = 0;
  for (;;) {
    const res = await fetch(input, init);
    if (res.status !== 429 || attempt >= maxAttempts - 1) return res;
    const ra = res.headers.get('Retry-After');
    let delayMs = ra ? parseInt(ra, 10) * 1000 : baseMs * 2 ** attempt;
    if (!Number.isFinite(delayMs) || delayMs < 0) delayMs = baseMs * 2 ** attempt;
    delayMs += Math.random() * 300;
    await new Promise((r) => setTimeout(r, delayMs));
    attempt += 1;
  }
}

export const STRIP_IMAGE_FALLBACK_BY_ID: Record<string, string> = {
  'prod-vitamin-b3-serum-pore-sebum-control': '/images/products/vitamin-b3-serum.png',
  'prod-retinol-peptide-night-serum': '/images/products/retinol-brightening-night-serum.png',
  'prod-skin-hydration-serum-snail-mucin': '/images/products/dark-spot-repair-snail-mucin-serum.png',
  'prod-vitamin-c-serum-antioxidant-pro-shield': '/images/products/vitamin-c-serum.png',
};

export function resolveProductImageForCheckout(
  productId: string,
  rawHint: string | undefined,
  apiBase: string
): string | null {
  const hint = rawHint?.trim();
  if (hint) {
    if (/^https?:\/\//i.test(hint)) return hint;
    if (hint.startsWith('//')) return `https:${hint}`;
    if (hint.startsWith('/')) {
      try {
        const base = apiBase.replace(/\/$/, '');
        return new URL(hint, `${base}/`).href;
      } catch {
        return null;
      }
    }
    return hint;
  }
  const rel = STRIP_IMAGE_FALLBACK_BY_ID[productId];
  if (rel) {
    try {
      const base = apiBase.replace(/\/$/, '');
      return new URL(rel, `${base}/`).href;
    } catch {
      return null;
    }
  }
  return null;
}
