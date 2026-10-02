import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {Duplex} from 'node:stream';
import {marketHealth, loopbackFacts, containerFacts} from './health.mjs';

const host = 'a'.repeat(56) + '.onion';
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = () => {throw Error('Live sockets forbidden in readiness regression');};
after(() => {net.Socket.prototype.connect = connect;});

// Exercise actual node:http request serialization against an in-memory transport.
// No server, listening socket, external connection or app process is created.
function transport(status, {silent = false, errorCode} = {}) {
  let wire = '';
  const stream = new Duplex({read() {}, write(chunk, encoding, done) {
    wire += chunk.toString();
    if (wire.includes('\r\n\r\n') && !silent) {
      queueMicrotask(() => this.push(`HTTP/1.1 ${status} Test\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`));
    }
    done();
  }});
  const agent = new http.Agent({keepAlive: false});
  agent.createConnection = () => stream;
  return {
    get(url, options, callback) {
      const request = http.get(url, {...options, agent}, callback);
      if (errorCode) queueMicrotask(() => stream.destroy(Object.assign(new Error('private detail'), {code: errorCode})));
      return request;
    },
    wire: () => wire,
  };
}

test('real HTTP serializer preserves onion Host and accepts healthy response', async () => {
  const io = transport(200);
  assert.deepEqual(await marketHealth(host, {get: io.get}), {ready: true, status: 200});
  assert.match(io.wire(), /^GET \/api\/health HTTP\/1\.1\r\n/);
  assert.ok(io.wire().includes('\r\nHost: ' + host + '\r\n'));
});

test('rejected Host, network refusal and timeout retain only safe facts', async () => {
  const rejected = transport(400);
  assert.deepEqual(await marketHealth(host, {get: rejected.get}), {ready: false, status: 400});
  const refused = transport(0, {silent: true, errorCode: 'ECONNREFUSED'});
  assert.deepEqual(await marketHealth(host, {get: refused.get}), {ready: false, errorCode: 'ECONNREFUSED'});
  const silent = transport(0, {silent: true});
  assert.deepEqual(await marketHealth(host, {get: silent.get, timeoutMs: 10}), {ready: false, errorCode: 'HEALTH_TIMEOUT'});
});

test('listener and owned-service diagnostics distinguish missing, exposed and exited services', () => {
  const facts = loopbackFacts('LISTEN 0 4096 127.0.0.1:43881 0.0.0.0:*\nLISTEN 0 4096 [::1]:43883 [::]:*\nLISTEN 0 511 0.0.0.0:43890 0.0.0.0:*');
  assert.deepEqual(facts.find(f => f.port === 43891), {port: 43891, required: true, present: false, loopbackOnly: true});
  assert.equal(facts.find(f => f.port === 43881).loopbackOnly, true);
  assert.equal(facts.find(f => f.port === 43883).loopbackOnly, true);
  assert.equal(facts.find(f => f.port === 43890).loopbackOnly, false);
  assert.equal(facts.find(f => f.port === 43886).required, false);
  assert.deepEqual(containerFacts('postgres running 0 false\nnbxplorer exited 1 false'), [
    {service: 'postgres', state: 'running', exitCode: 0, oomKilled: false},
    {service: 'nbxplorer', state: 'exited', exitCode: 1, oomKilled: false}]);
  assert.throws(() => containerFacts('tor running 0 false private-value'), /Invalid service facts/);
});
