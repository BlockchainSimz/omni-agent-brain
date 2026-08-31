import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const request = (server, { method = 'GET', path = '/health', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const address = server.address();
  const req = http.request({ host: '127.0.0.1', port: address.port, method, path, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) } }, res => { let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) })); });
  req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
});

test('hardened service exposes health and request correlation', async () => {
  process.env.NODE_ENV = 'test';
  const { server } = await import('../src/index.js');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(server, { headers: { 'x-request-id': 'integration-1' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers['x-request-id'], 'integration-1');
    assert.equal(response.body.status, 'ok');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('protected endpoint rejects unauthorized access', async () => {
  const { server } = await import('../src/index.js');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { const response = await request(server, { path: '/v1/snapshot' }); assert.equal(response.status, 401); assert.equal(response.body.error, 'unauthorized'); }
  finally { await new Promise(resolve => server.close(resolve)); }
});
