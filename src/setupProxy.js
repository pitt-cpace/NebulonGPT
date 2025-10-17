const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  console.log('🔧 setupProxy.js loaded! Configuring proxy for /api -> http://localhost:3001');
  
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:3001',
      changeOrigin: true,
      pathRewrite: function (path, req) {
        // app.use strips /api, so we need to add it back
        return '/api' + path;
      },
      onProxyReq: (proxyReq, req, res) => {
        console.log('📡 Proxying:', req.method, req.path, '-> http://localhost:3001' + req.path);
      },
    })
  );
};
