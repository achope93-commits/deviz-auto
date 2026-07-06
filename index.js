const https = require('https');

function makeRequest(hostname, path, headers, callback) {
  const options = { hostname, path, method: 'GET', headers };
  const req = https.request(options, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => callback(null, data));
  });
  req.on('error', err => callback(err));
  req.end();
}

function postRequest(hostname, path, headers, body, callback) {
  const bodyStr = JSON.stringify(body);
  const options = {
    hostname, path, method: 'POST',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) }
  };
  const req = https.request(options, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => callback(null, data));
  });
  req.on('error', err => callback(err));
  req.write(bodyStr);
  req.end();
}

const server = require('http').createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Health check
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'Deviz Auto API Server' }));
    return;
  }

  // VIN decode endpoint
  if (req.method === 'GET' && req.url.startsWith('/vin/')) {
    const vin = req.url.replace('/vin/', '').trim();
    makeRequest(
      'auto-parts-catalog.apiprofile.com',
      `/api/vin/decode/vin/${vin}`,
      {
        'Content-Type': 'application/json',
        'x-apiprofile-key': process.env.AUTOPARTS_API_KEY
      },
      (err, data) => {
        if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      }
    );
    return;
  }

  // Parts search by VIN endpoint
  if (req.method === 'GET' && req.url.startsWith('/parts/')) {
    const parts = req.url.replace('/parts/', '').split('/');
    const vehicleId = parts[0];
    const category = parts[1] || '';
    makeRequest(
      'auto-parts-catalog.apiprofile.com',
      `/api/vehicle/get-parts/vehicle-id/${vehicleId}${category ? '/category/' + category : ''}`,
      {
        'Content-Type': 'application/json',
        'x-apiprofile-key': process.env.AUTOPARTS_API_KEY
      },
      (err, data) => {
        if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      }
    );
    return;
  }

  // Anthropic AI endpoint (POST)
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        postRequest(
          'api.anthropic.com',
          '/v1/messages',
          {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
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
