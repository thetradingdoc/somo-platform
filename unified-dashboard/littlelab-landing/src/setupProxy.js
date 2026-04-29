/**
 * CRA dev server: forward /api to local middleware so same-origin fetches work on :3000.
 * @see https://create-react-app.dev/docs/proxying-api-requests-in-development/
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  const target = process.env.REACT_APP_API_PROXY_TARGET || 'http://127.0.0.1:4000';
  app.use(
    '/api',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      logLevel: 'warn'
    })
  );
};
