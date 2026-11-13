import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Run only in an isolated container: all state and the onion hostname are synthetic.
const root = mkdtempSync(join(tmpdir(), 'market-runtime-smoke-'));
const hostname = join(root, 'hostname');
const onion = `${'a'.repeat(56)}.onion`;
writeFileSync(hostname, `${onion}\n`);
const request = (path) => new Promise((resolve, reject) => {
  get({ host: '127.0.0.1', port: 3100, path, headers: { host: onion } }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
    res.on('error', reject);
  }).on('error', reject);
});
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3100', DATA_DIR: join(root, 'data'), ONION_HOST_FILE: hostname },
  stdio: 'inherit',
});
try {
  let response;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(`Server exited: ${child.exitCode}`);
    try { response = await request('/api/session'); break; }
    catch { await delay(100); }
  }
  assert.ok(response, 'Server did not start');
  assert.equal(response.status, 200);
  const session = JSON.parse(response.body);
  assert.equal(session.user, null);
  assert.equal(session.paymentMode, 'btcpay');
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /<html/i);
  console.log('Production image synthetic startup and anonymous routes passed');
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}
