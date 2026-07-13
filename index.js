const https = require('https');

function makeRequest(hostname, path, method, headers, body, callback) {
  const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
  const options = {
    hostname, path, method,
    headers: bodyStr ? { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) } : headers,
    timeout: 5000
  };
  const req = https.request(options, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => callback(null, data));
  });
  req.on('error', err => callback(err));
  req.on('timeout', () => { req.destroy(); callback(new Error('timeout')); });
  if (bodyStr) req.write(bodyStr);
  req.end();
}

// Proxy catre AutoPartsAPI cu fallback automat
function autoPartsRequest(path, method, body, contentType, callback) {
  const primaryHeaders = {
    'Content-Type': contentType || 'application/json',
    'x-apiprofile-key': process.env.AUTOPARTS_API_KEY
  };

  const fallbackHeaders = {
    'Content-Type': contentType || 'application/json',
    'x-rapidapi-host': 'autodoc-parts-catalog.p.rapidapi.com',
    'x-rapidapi-key': process.env.RAPIDAPI_KEY
  };

  // Incearca apiprofile
  makeRequest('auto-parts-catalog.apiprofile.com', path, method, primaryHeaders, body, (err, data) => {
    if (!err && data && !data.includes('"error"') && data.length > 10) {
      return callback(null, data, 'apiprofile');
    }
    // Fallback pe Autodoc/RapidAPI
    console.log('apiprofile failed, switching to Autodoc RapidAPI...');
    makeRequest('autodoc-parts-catalog.p.rapidapi.com', path, method, fallbackHeaders, body, (err2, data2) => {
      if (err2) return callback(err2);
      callback(null, data2, 'autodoc');
    });
  });
}

const server = require('http').createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'Deviz Auto API Server v2' }));
    return;
  }

  // Proxy GET catre AutoPartsAPI cu fallback
  if (req.method === 'GET' && req.url.startsWith('/autoparts/')) {
    const apiPath = req.url.replace('/autoparts', '');
    autoPartsRequest(apiPath, 'GET', null, 'application/json', (err, data, source) => {
      if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Data-Source': source || 'unknown' });
      res.end(data);
    });
    return;
  }

  // Proxy POST catre AutoPartsAPI cu fallback
  if (req.method === 'POST' && req.url.startsWith('/autoparts/')) {
    const apiPath = req.url.replace('/autoparts', '');
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const bodyBuffer = Buffer.concat(body);
      const contentType = req.headers['content-type'] || 'application/json';

      const primaryHeaders = {
        'x-apiprofile-key': process.env.AUTOPARTS_API_KEY,
        'content-type': contentType,
        'content-length': bodyBuffer.length
      };

      const fallbackHeaders = {
        'x-rapidapi-host': 'autodoc-parts-catalog.p.rapidapi.com',
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'content-type': contentType,
        'content-length': bodyBuffer.length
      };

      // Incearca apiprofile
      const primaryOptions = {
        hostname: 'auto-parts-catalog.apiprofile.com',
        path: apiPath, method: 'POST',
        headers: primaryHeaders, timeout: 5000
      };

      const tryFallback = () => {
        console.log('apiprofile POST failed, switching to Autodoc...');
        const fallbackOptions = {
          hostname: 'autodoc-parts-catalog.p.rapidapi.com',
          path: apiPath, method: 'POST',
          headers: fallbackHeaders, timeout: 5000
        };
        const apiReq2 = https.request(fallbackOptions, apiRes2 => {
          let data = '';
          apiRes2.on('data', chunk => data += chunk);
          apiRes2.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Data-Source': 'autodoc' });
            res.end(data);
          });
        });
        apiReq2.on('error', err => { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); });
        apiReq2.on('timeout', () => { apiReq2.destroy(); res.writeHead(504); res.end(JSON.stringify({ error: 'Both sources timeout' })); });
        apiReq2.write(bodyBuffer);
        apiReq2.end();
      };

      const apiReq = https.request(primaryOptions, apiRes => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          if (data && data.length > 10 && !data.includes('"error"')) {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Data-Source': 'apiprofile' });
            res.end(data);
          } else {
            tryFallback();
          }
        });
      });
      apiReq.on('error', tryFallback);
      apiReq.on('timeout', () => { apiReq.destroy(); tryFallback(); });
      apiReq.write(bodyBuffer);
      apiReq.end();
    });
    return;
  }

  // Anthropic AI endpoint
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const bodyStr = JSON.stringify(parsed);
        const options = {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(bodyStr)
          }
        };
        const apiReq = https.request(options, apiRes => {
          let data = '';
          apiRes.on('data', chunk => data += chunk);
          apiRes.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
          });
        });
        apiReq.on('error', err => { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); });
        apiReq.write(bodyStr);
        apiReq.end();
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
