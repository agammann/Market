import test from 'node:test';
import assert from 'node:assert/strict';
import {registrationFact, registrationPage} from './registration-diagnostics.mjs';

test('registration diagnostics retain only fixed paths, statuses and booleans', () => {
  const origin = 'http://' + 'a'.repeat(56) + '.onion';
  const secret = 'private-credential-do-not-retain';
  const url = origin + '/api/session?token=' + secret;
  assert.deepEqual(registrationFact(origin, 'body', url, {readable: true,
    body: {user: {id: secret, username: secret}, csrf: secret}, error: secret}),
  {event: 'body', path: '/api/session', authenticated: true, csrfPresent: true, bodyReadable: true});
  assert.deepEqual(registrationFact(origin, 'body', url, {readable: true, body: {user: null, csrf: null}}),
    {event: 'body', path: '/api/session', authenticated: false, csrfPresent: false, bodyReadable: true});
  assert.deepEqual(registrationFact(origin, 'response', url, {status: 200, headers: {cookie: secret}}),
    {event: 'response', path: '/api/session', status: 200});
  assert.deepEqual(registrationFact(origin, 'failed', url, {error: secret}), {event: 'failed', path: '/api/session'});
  assert.equal(registrationFact(origin, 'body', 'https://example.com/api/session'), null);
  assert.equal(registrationFact(origin, 'body', origin + '/api/orders/' + secret), null);
  assert.equal(registrationFact(origin, secret, url), null);
  assert.equal(registrationPage(origin, origin + '/account?token=' + secret), '/account');
  assert.equal(registrationPage(origin, origin + '/orders/' + secret), 'other');
});
