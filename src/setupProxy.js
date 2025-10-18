const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  console.log('🔧 setupProxy.js loaded! Configuring proxy for /api -> http://127.0.0.1:3001');
  
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://127.0.0.1:3001',
      changeOrigin: true,
      pathRewrite: function (path, req) {
        // app.use strips /api, so we need to add it back
        return '/api' + path;
      },
      onProxyReq: (proxyReq, req, res) => {
        console.log('📡 Proxying:', req.method, req.path, '-> http://127.0.0.1:3001/api' + req.path);
      },
      onError: (err, req, res) => {
        console.error('❌ Proxy error:', err.message);
        res.writeHead(502, {
          'Content-Type': 'text/plain'
        });
        res.end('Proxy error: ' + err.message);
      },
    })
  );
};
