const https = require('https');

function makeRequest(hostname, path, method, headers, body, timeoutMs, callback) {
  const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
  const options = {
    hostname, path, method,
    headers: bodyStr ? { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) } : headers,
    timeout: timeoutMs || 5000
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

  // Proxy GET cu fallback
  if (req.method === 'GET' && req.url.startsWith('/autoparts/')) {
    const apiPath = req.url.replace('/autoparts', '');
    let sent = false;

    const sendResponse = (data, source) => {
      if (sent) return;
      sent = true;
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Data-Source': source });
      res.end(data);
    };

    const tryFallback = () => {
      makeRequest('autodoc-parts-catalog.p.rapidapi.com', apiPath, 'GET', {
        'Content-Type': 'application/json',
        'x-rapidapi-host': 'autodoc-parts-catalog.p.rapidapi.com',
        'x-rapidapi-key': process.env.RAPIDAPI_KEY
      }, null, 8000, (err, data) => {
        if (sent) return;
        if (err) { sent = true; res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
        sendResponse(data, 'autodoc');
      });
    };

    makeRequest('auto-parts-catalog.apiprofile.com', apiPath, 'GET', {
      'Content-Type': 'application/json',
      'x-apiprofile-key': process.env.AUTOPARTS_API_KEY
    }, null, 4000, (err, data) => {
      if (sent) return;
      if (!err && data && data.length > 10 && !data.startsWith('<')) {
        sendResponse(data, 'apiprofile');
      } else {
        console.log('apiprofile GET failed, switching to Autodoc...');
        tryFallback();
      }
    });
    return;
  }

  // Proxy POST cu fallback
  if (req.method === 'POST' && req.url.startsWith('/autoparts/')) {
    const apiPath = req.url.replace('/autoparts', '');
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const bodyBuffer = Buffer.concat(body);
      const contentType = req.headers['content-type'] || 'application/json';
      let sent = false;

      const sendResponse = (data, source) => {
        if (sent) return;
        sent = true;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Data-Source': source });
        res.end(data);
      };

      const tryFallback = () => {
        if (sent) return;
        console.log('apiprofile POST failed, switching to Autodoc...');
        const fallbackOptions = {
          hostname: 'autodoc-parts-catalog.p.rapidapi.com',
          path: apiPath, method: 'POST',
          headers: {
            'x-rapidapi-host': 'autodoc-parts-catalog.p.rapidapi.com',
            'x-rapidapi-key': process.env.RAPIDAPI_KEY,
            'content-type': contentType,
            'content-length': bodyBuffer.length
          },
          timeout: 8000
        };
        const r = https.request(fallbackOptions, apiRes => {
          let data = '';
          apiRes.on('data', chunk => data += chunk);
          apiRes.on('end', () => sendResponse(data, 'autodoc'));
        });
        r.on('error', err => { if (!sent) { sent = true; res.writeHead(500); res.end(JSON.stringify({ error: err.message })); } });
        r.on('timeout', () => { r.destroy(); if (!sent) { sent = true; res.writeHead(504); res.end(JSON.stringify({ error: 'Both timeout' })); } });
        r.write(bodyBuffer);
        r.end();
      };

      const primaryOptions = {
        hostname: 'auto-parts-catalog.apiprofile.com',
        path: apiPath, method: 'POST',
        headers: {
          'x-apiprofile-key': process.env.AUTOPARTS_API_KEY,
          'content-type': contentType,
          'content-length': bodyBuffer.length
        },
        timeout: 4000
      };
      const r = https.request(primaryOptions, apiRes => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          if (!sent && data && data.length > 10 && !data.startsWith('<')) {
            sendResponse(data, 'apiprofile');
          } else {
            tryFallback();
          }
        });
      });
      r.on('error', () => tryFallback());
      r.on('timeout', () => { r.destroy(); tryFallback(); });
      r.write(bodyBuffer);
      r.end();
    });
    return;
  }

  // Anthropic AI
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const bodyStr = JSON.stringify(parsed);
        const options = {
          hostname: 'api.anthropic.com',
          path: '/v1/messages', method: 'POST',
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
          apiRes.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(data); });
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
