import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';

function request(port, path = '/health') {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, agent: false, headers: { connection: 'close' } }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.setTimeout(10_000, () => req.destroy(new Error('request_timeout')));
    req.on('error', reject);
  });
}

async function startServer() {
  const child = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, NODE_ENV: 'test', PORT: '0', OMNI_BRAIN_RATE_LIMIT: '1000' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timer = setTimeout(() => rejectReady(new Error(`server_start_timeout: ${output}`)), 10_000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    output += chunk;
    const match = output.match(/Omni Agent Brain listening on (\d+)/);
    if (match) { clearTimeout(timer); resolveReady(Number(match[1])); }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { output += chunk; });
  child.once('error', error => { clearTimeout(timer); rejectReady(error); });
  child.once('exit', (code, signal) => {
    if (code !== 0) rejectReady(new Error(`server_exited:${code}:${signal}:${output}`));
  });
  const port = await ready;
  return { child, port };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server_shutdown_timeout')), 12_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

test('HTTP health endpoint survives concurrent smoke load', { timeout: 30_000 }, async () => {
  const { child, port } = await startServer();
  try {
    const responses = await Promise.all(Array.from({ length: 100 }, () => request(port)));
    assert.equal(responses.length, 100);
    assert.ok(responses.every(status => status === 200));
  } finally {
    await stopServer(child);
  }
});
