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

export function loopbackFacts(output) {
  const endpoints = output.split('\n').map(line => line.trim().split(/\s+/)[3]).filter(Boolean);
  return [43881, 43882, 43883, 43884, 43885, 43886, 43887, 43888, 43889, 43890, 43891, 49393].map(port => {
    const matches = endpoints.filter(endpoint => endpoint.endsWith(':' + port));
    return {port, required: ![43882, 43885, 43886].includes(port), present: matches.length > 0,
      loopbackOnly: matches.every(endpoint => endpoint === '127.0.0.1:' + port || endpoint === '[::1]:' + port)};
  });
}

export function containerFacts(output) {
  const names = new Set(['postgres', 'bitcoin', 'nbxplorer', 'monero', 'seller-wallet', 'buyer-wallet', 'btcpay', 'tor']);
  const states = new Set(['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead']);
  return output.trim().split('\n').slice(0, 8).map(line => {
    const [service, state, code, oom, extra] = line.trim().split(/\s+/);
    if (!names.has(service) || !states.has(state) || !/^\d{1,3}$/.test(code) || !['true', 'false'].includes(oom) || extra) throw Error('Invalid service facts');
    return {service, state, exitCode: Number(code), oomKilled: oom === 'true'};
  });
}
