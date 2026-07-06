const https = require('https');

function makeRequest(hostname, path, method, headers, body, callback) {
  const bodyStr = body ? JSON.stringify(body) : null;
  const options = {
    hostname, path, method,
    headers: bodyStr
      ? { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) }
      : headers
  };
  const req = https.request(options, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => callback(null, data));
  });
  req.on('error', err => callback(err));
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
    res.end(JSON.stringify({ status: 'ok', message: 'Deviz Auto API Server' }));
    return;
  }

  // Proxy GET catre AutoPartsAPI
  if (req.method === 'GET' && req.url.startsWith('/autoparts/')) {
    const apiPath = req.url.replace('/autoparts', '');
    makeRequest(
      'auto-parts-catalog.apiprofile.com', apiPath, 'GET',
      { 'Content-Type': 'application/json', 'x-apiprofile-key': process.env.AUTOPARTS_API_KEY },
      null,
      (err, data) => {
        if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      }
    );
    return;
  }

  // Proxy POST catre AutoPartsAPI (piese per vehicul)
  if (req.method === 'POST' && req.url.startsWith('/autoparts/')) {
    const apiPath = req.url.replace('/autoparts', '');
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      makeRequest(
        'auto-parts-catalog.apiprofile.com', apiPath, 'POST',
        { 'Content-Type': 'application/json', 'x-apiprofile-key': process.env.AUTOPARTS_API_KEY },
        parsed,
        (err, data) => {
          if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(data);
        }
      );
    });
    return;
  }

  // Anthropic AI endpoint (POST fara prefix)
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        makeRequest(
          'api.anthropic.com', '/v1/messages', 'POST',
          { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          parsed,
          (err, data) => {
            if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
          }
        );
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
