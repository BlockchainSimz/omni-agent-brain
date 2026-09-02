import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const hasDatabase = Boolean(process.env.OMNI_BRAIN_DATABASE_URL);

test('HTTP runtime persists through PostgreSQL and reports readiness', { skip: !hasDatabase }, async () => {
  const { server, store, databaseRuntime } = await import('../src/index.js');
  await databaseRuntime.persistence.pool.query('DELETE FROM omni_brain_state WHERE id = 1');
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  const request = (method, path, payload) => new Promise((resolve, reject) => {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'idempotency-key': `http-test-${Date.now()}` } : {} }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

  try {
    const ready = await request('GET', '/ready');
    assert.equal(ready.status, 200);
    assert.equal(ready.body.ready, true);
    assert.equal(ready.body.dependencies.postgres, true);

    const created = await request('POST', '/v1/memories', { content: 'http postgres fact', source: 'http-integration' });
    assert.equal(created.status, 201);
    assert.equal(created.body.content, 'http postgres fact');

    const snapshot = await request('GET', '/v1/snapshot');
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.memories[0].id, created.body.id);

    const persisted = await store.snapshot();
    assert.equal(persisted.memories[0].id, created.body.id);
  } finally {
    await databaseRuntime.persistence.pool.query('DELETE FROM omni_brain_state WHERE id = 1').catch(() => {});
    await new Promise(resolve => server.close(resolve));
    await databaseRuntime.close();
  }
});
