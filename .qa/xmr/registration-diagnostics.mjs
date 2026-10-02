const endpoints = new Set(['/api/session', '/api/register', '/api/account']);
const events = new Set(['request', 'response', 'finished', 'failed', 'body']);

// Project transient browser data to an explicit allowlist before retaining it.
export function registrationFact(origin, event, url, value = {}) {
  let parsed;
  try {parsed = new URL(url);} catch {return null;}
  if (parsed.origin !== origin || !endpoints.has(parsed.pathname) || !events.has(event)) return null;
  const fact = {event, path: parsed.pathname};
  if (event === 'response' && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599) fact.status = value.status;
  if (event === 'body') {
    fact.authenticated = Boolean(value.body?.user);
    fact.csrfPresent = typeof value.body?.csrf === 'string' && value.body.csrf.length > 0;
    fact.bodyReadable = value.readable === true;
  }
  return fact;
}

export function registrationPage(origin, url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && ['/', '/login', '/account'].includes(parsed.pathname) ? parsed.pathname : 'other';
  } catch {return 'other';}
}
