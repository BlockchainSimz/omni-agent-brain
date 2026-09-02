import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const hasDatabase = Boolean(process.env.OMNI_BRAIN_DATABASE_URL);

test('HTTP runtime persists through PostgreSQL and reports readiness', { skip: !hasDatabase }, async () => {
  process.env.NODE_ENV = 'test';
  process.env.OMNI_BRAIN_DATABASE_TABLE = `omni_brain_http_${process.pid}`;
  const { server, store, databaseRuntime } = await import('../src/index.js');
  const table = process.env.OMNI_BRAIN_DATABASE_TABLE;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, resolve);
  });
  const port = server.address().port;

  const request = (method, path, payload) => new Promise((resolve, reject) => {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const headers = body
      ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'idempotency-key': `http-test-${Date.now()}-${Math.random()}` }
      : {};
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers }, res => {
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

    const healthy = await request('GET', '/health');
    assert.equal(healthy.status, 200);
    assert.equal(healthy.body.status, 'ok');

    const originalHealthcheck = databaseRuntime.persistence.healthcheck;
    databaseRuntime.persistence.healthcheck = async () => { throw new Error('simulated_connection_loss'); };
    try {
      const degraded = await request('GET', '/ready');
      assert.equal(degraded.status, 503);
      assert.equal(degraded.body.ready, false);
      assert.equal(degraded.body.status, 'degraded');
      assert.equal(degraded.body.dependencies.postgres, false);

      const stillLive = await request('GET', '/health');
      assert.equal(stillLive.status, 200);
      assert.equal(stillLive.body.status, 'ok');
    } finally {
      databaseRuntime.persistence.healthcheck = originalHealthcheck;
    }

    const recovered = await request('GET', '/ready');
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.ready, true);
    assert.equal(recovered.body.dependencies.postgres, true);

    const created = await request('POST', '/v1/memories', { content: 'http postgres fact', source: 'http-integration' });
    assert.equal(created.status, 201);
    assert.equal(created.body.content, 'http postgres fact');

    const snapshot = await request('GET', '/v1/snapshot');
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.memories[0].id, created.body.id);

    const persisted = await store.snapshot();
    assert.equal(persisted.memories[0].id, created.body.id);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await databaseRuntime.persistence.pool.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    await databaseRuntime.close();
  }
});
