/**
 * Same-domain API proxy for myskinandcare.com (optional Cloudflare Worker).
 * Routes API + voice webhooks to Cloud Run when using split UI/API on one browser origin.
 *
 * Deploy: cd infra/edge-routing/cloudflare/myskin-api-proxy && npx wrangler deploy
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const backendOrigin = (
      env.BACKEND_ORIGIN ||
      globalThis.BACKEND_ORIGIN ||
      'https://api.myskinandcare.com'
    ).replace(/\/$/, '');

    const proxyPrefixes = ['/api/', '/voice/', '/webhooks/', '/health'];
    const shouldProxy =
      proxyPrefixes.some((p) => url.pathname.startsWith(p)) ||
      url.pathname === '/health';

    if (!shouldProxy) {
      return fetch(request);
    }

    const upstream = new URL(`${backendOrigin}${url.pathname}${url.search}`);
    const headers = new Headers(request.headers);
    headers.set('host', new URL(backendOrigin).host);

    const init = {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'follow'
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.duplex = 'half';
    }

    return fetch(upstream.toString(), init);
  }
};
