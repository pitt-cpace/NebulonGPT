const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  console.log('\n========================================');
  console.log('SETUPPROXY.JS LOADED!!!');
  console.log('========================================\n');
  
  // Ollama proxy - MUST come BEFORE general /api proxy
  console.log('Setting up Ollama proxy: /api/ollama -> http://localhost:11434');
  app.use(
    '/api/ollama',
    createProxyMiddleware({
      target: 'http://localhost:11434',
      changeOrigin: true,
      pathRewrite: {
        '^/api/ollama': '/api'
      },
      onProxyReq: (proxyReq, req, res) => {
        console.log(`[OLLAMA PROXY] ${req.method} ${req.path} -> http://localhost:11434${req.path.replace('/api/ollama', '/api')}`);
      },
      onProxyRes: (proxyRes, req, res) => {
        console.log(`[OLLAMA PROXY] Response ${proxyRes.statusCode} for ${req.path}`);
      },
      onError: (err, req, res) => {
        console.error('[OLLAMA PROXY] ERROR:', err.message);
        res.writeHead(502, {
          'Content-Type': 'application/json'
        });
        res.end(JSON.stringify({ 
          error: 'Ollama proxy error', 
          message: err.message,
          hint: 'Is Ollama running on localhost:11434?'
        }));
      },
    })
  );
  
  // General API proxy to unified backend
  console.log('Setting up backend proxy: /api -> http://127.0.0.1:3001');
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://127.0.0.1:3001',
      changeOrigin: true,
      // Don't rewrite path - backend expects /api prefix
      onProxyReq: (proxyReq, req, res) => {
        console.log(`[BACKEND PROXY] ${req.method} ${req.path} -> http://127.0.0.1:3001${req.path}`);
      },
      onProxyRes: (proxyRes, req, res) => {
        console.log(`[BACKEND PROXY] Response ${proxyRes.statusCode} for ${req.path}`);
      },
      onError: (err, req, res) => {
        console.error('[BACKEND PROXY] ERROR:', err.message);
        res.writeHead(502, {
          'Content-Type': 'application/json'
        });
        res.end(JSON.stringify({ 
          error: 'Backend proxy error', 
          message: err.message,
          hint: 'Is the backend running on port 3001?'
        }));
      },
    })
  );
  
  console.log('\n========================================');
  console.log('PROXY CONFIGURATION COMPLETE');
  console.log('========================================\n');
};
