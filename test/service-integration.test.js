import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'production';
delete process.env.OMNI_BRAIN_API_KEY;

const request = (server, { method = 'GET', path = '/health', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const address = server.address();
  if (!address || typeof address === 'string') return reject(new Error('server is not listening'));
  const req = http.request({ host: '127.0.0.1', port: address.port, method, path, agent: false, headers: { connection: 'close', ...headers, ...(body ? { 'content-type': 'application/json' } : {}) } }, res => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); } catch (error) { reject(error); }
    });
  });
  req.setTimeout(10_000, () => req.destroy(new Error('request_timeout')));
  req.on('error', reject);
  if (body) req.write(JSON.stringify(body));
  req.end();
});

async function listen(server) {
  await new Promise((resolve, reject) => { const onError = error => reject(error); server.once('error', onError); server.listen(0, '127.0.0.1', () => { server.off('error', onError); resolve(); }); });
}

async function close(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(() => resolve()));
}

test('hardened service exposes health and request correlation', async () => {
  const { server } = await import('../src/index.js');
  await listen(server);
  try {
    const response = await request(server, { headers: { 'x-request-id': 'integration-1' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers['x-request-id'], 'integration-1');
    assert.equal(response.body.status, 'ok');
  } finally { await close(server); }
});

test('protected endpoint rejects unauthorized access', async () => {
  const { server } = await import('../src/index.js');
  await listen(server);
  try {
    const response = await request(server, { path: '/v1/snapshot' });
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'unauthorized');
  } finally { await close(server); }
});
