import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.OMNI_BRAIN_RATE_LIMIT = '1000';

const request = port => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port, path: '/health', agent: false, headers: { connection: 'close' } }, res => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.setTimeout(10_000, () => req.destroy(new Error('request_timeout')));
  req.on('error', reject);
});

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
}

async function close(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(() => resolve()));
}

test('HTTP health endpoint survives concurrent smoke load', { timeout: 30_000 }, async () => {
  const { server } = await import('../src/index.js');
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const responses = await Promise.all(Array.from({ length: 100 }, () => request(address.port)));
    assert.equal(responses.length, 100);
    assert.ok(responses.every(status => status === 200));
  } finally {
    await close(server);
  }
});
