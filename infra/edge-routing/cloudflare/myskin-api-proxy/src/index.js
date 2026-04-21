export default {
  async fetch(request) {
    const url = new URL(request.url);
    const backendOrigin = (globalThis.BACKEND_ORIGIN || 'https://api.myskinandcare.com').replace(/\/$/, '');
    const upstream = new URL(`${backendOrigin}${url.pathname}${url.search}`);
    const headers = new Headers(request.headers);
    headers.set('host', new URL(backendOrigin).host);
    const init = {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'follow'
    };
    const resp = await fetch(upstream.toString(), init);
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers
    });
  }
};

