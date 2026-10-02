import http from 'node:http';

// Match Market's own health helper: fetch removes the required custom Host header.
export function marketHealth(host, {timeoutMs = 5000, get = http.get} = {}) {
  if (!/^[a-z2-7]{56}\.onion$/.test(host)) throw Error('Invalid test onion hostname');
  return new Promise(resolve => {
    let settled = false;
    let timer;
    const finish = facts => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(facts);
    };
    const request = get('http://127.0.0.1:43890/api/health', {headers: {Host: host}}, response => {
      const status = response.statusCode;
      response.resume();
      response.on('end', () => finish({ready: status === 200, status}));
      response.on('error', () => finish({ready: false, errorCode: 'RESPONSE_ERROR'}));
    });
    request.on('error', error => finish({ready: false,
      errorCode: /^[A-Z][A-Z0-9_]{0,39}$/.test(error.code || '') ? error.code : 'REQUEST_ERROR'}));
    timer = setTimeout(() => {
      finish({ready: false, errorCode: 'HEALTH_TIMEOUT'});
      request.destroy();
    }, timeoutMs);
  });
}
