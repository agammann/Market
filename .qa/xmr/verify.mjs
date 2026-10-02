import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {marketHealth, loopbackFacts, containerFacts} from './health.mjs';
import {registrationFact, registrationPage} from './registration-diagnostics.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_OS, 'Linux');
const root = process.env.QA_RUNTIME;
const app = process.env.QA_APP;
const reportPath = process.env.QA_REPORT;
const credentials = JSON.parse(fs.readFileSync(path.join(root, 'credentials.json')));
const {amount} = await import(pathToFileURL(path.join(app, 'server/money.mjs')));
const report = {source: '8d22844f8c5f41caea40b5f857220db742109ef3', result: 'running',
  checks: [], limitations: ['Isolated fakechain only; no mainnet funds.',
    'Native app plus loopback Linux containers; not production Compose isolation or restoration.',
    'Physical delivery is fictional.']};
let stage = 'readiness';
let market, browser, providerBrowser;
let registrationSnapshot, registrationCleanup;
const save = () => fs.writeFileSync(reportPath, JSON.stringify({...report, stage}, null, 2));
const pass = name => {report.checks.push(name); save();};
save();
async function bounded(fn, seconds = 120) {
  const until = Date.now() + seconds * 1000;
  while (true) {
    try {if (await fn()) return;} catch {}
    if (Date.now() >= until) throw Error('Readiness deadline');
    await delay(2500);
  }
}
async function json(url, init = {}) {
  const response = await fetch(url, {...init, signal: AbortSignal.timeout(30000)});
  assert.ok(response.ok, 'Unexpected HTTP status');
  return response.json();
}
async function rpc(port, method, params = {}) {
  const value = await json(`http://127.0.0.1:${port}/json_rpc`, {method: 'POST',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 'qa', method, params})});
  assert.ok(!value.error, 'RPC rejected operation');
  return value.result;
}
async function guardChain() {
  const info = await rpc(43884, 'get_info');
  assert.equal(info.nettype, 'fakechain');
  assert.equal(info.incoming_connections_count, 0);
  assert.equal(info.outgoing_connections_count, 0);
  return info;
}
async function mine(blocks, buyerAddress) {
  await guardChain();
  assert.ok(Number.isInteger(blocks) && blocks > 0 && blocks <= 110);
  return rpc(43884, 'generateblocks', {wallet_address: buyerAddress, amount_of_blocks: blocks});
}
const providerBase = 'http://127.0.0.1:49393';
const basic = 'Basic ' + Buffer.from(credentials.providerEmail + ':' + credentials.providerPassword).toString('base64');
let providerToken;
async function providerApi(route, body) {
  return json(providerBase + route, {method: body ? 'POST' : 'GET',
    headers: {Authorization: providerToken ? 'token ' + providerToken : basic, 'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
}
const appEnv = {...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '43890',
  DATA_DIR: path.join(root, 'app'), ONION_HOST_FILE: path.join(root, 'tor/app/hostname'),
  TOR_SOCKS_URL: 'socks5h://127.0.0.1:43889'};
function startMarket() {
  const log = fs.openSync(path.join(root, 'market.log'), 'a', 0o600);
  market = spawn(process.execPath, ['server/index.mjs'], {cwd: app, env: appEnv, stdio: ['ignore', log, log]});
  fs.writeFileSync(path.join(root, 'market.pid'), String(market.pid));
  fs.closeSync(log);
}
async function marketReady(host) {
  const facts = await marketHealth(host);
  report.marketReadiness = {...facts, processExitCode: market?.exitCode ?? null,
    processSignal: market?.signalCode ?? null};
  save();
  return facts.ready;
}
async function stopMarket() {
  if (!market || market.exitCode !== null) return;
  const child = market;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([stopped, delay(10000)]);
  if (child.exitCode === null) {child.kill('SIGKILL'); await stopped;}
  market = null;
  fs.rmSync(path.join(root, 'market.pid'), {force: true});
}
function admin(args, input) {
  execFileSync(process.execPath, ['scripts/admin.mjs', ...args], {cwd: app, env: appEnv,
    input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000});
}
async function cleanup() {
  await browser?.close().catch(() => {});
  await providerBrowser?.close().catch(() => {});
  await stopMarket();
}
process.once('SIGTERM', async () => {report.result = 'timeout'; save(); await cleanup(); process.exit(124);});

try {
  await bounded(async () => {await guardChain(); return true;}, 180);
  for (const port of [43887, 43888]) {
    await bounded(async () => {await rpc(port, 'get_version'); return true;});
    await rpc(port, 'create_wallet', {filename: 'wallet', password: '', language: 'English'});
  }
  const buyerAddress = (await rpc(43888, 'get_address')).address;
  await mine(110, buyerAddress);
  for (const port of [43887, 43888]) await rpc(port, 'refresh');
  assert.ok((await rpc(43888, 'get_balance')).unlocked_balance > 0);
  pass('real_fakechain_wallets_funded');
  await bounded(async () => (await fetch(providerBase, {signal: AbortSignal.timeout(5000)})).ok, 240);
  await bounded(() => ['app', 'provider'].every(name => fs.existsSync(path.join(root, 'tor', name, 'hostname'))), 180);
  const host = fs.readFileSync(path.join(root, 'tor/app/hostname'), 'utf8').trim();
  const providerHost = fs.readFileSync(path.join(root, 'tor/provider/hostname'), 'utf8').trim();
  assert.match(host, /^[a-z2-7]{56}\.onion$/);
  assert.match(providerHost, /^[a-z2-7]{56}\.onion$/);
  assert.notEqual(host, providerHost);
  const origin = 'http://' + host;
  const executablePath = process.env.CHROME_BIN || '/usr/bin/google-chrome';
  providerBrowser = await chromium.launch({executablePath, headless: true, chromiumSandbox: true});
  report.browserVersion = providerBrowser.version();
  const providerPage = await providerBrowser.newPage();
  providerPage.setDefaultTimeout(60000);
  stage = 'provider_registration'; save();
  await providerPage.goto(providerBase + '/register');
  await providerPage.locator('input[name="Email"]').fill(credentials.providerEmail);
  await providerPage.locator('input[name="Password"]').fill(credentials.providerPassword);
  await providerPage.locator('input[name="ConfirmPassword"]').fill(credentials.providerPassword);
  await providerPage.locator('#RegisterButton').click();
  await bounded(async () => {await providerApi('/api/v1/stores'); return true;}, 60);
  const store = await providerApi('/api/v1/stores', {name: 'Disposable XMR verification', defaultCurrency: 'XMR'});
  assert.ok(store.id);
  // Initial Basic access expires after five minutes. Mint the narrow key immediately.
  const key = await providerApi('/api/v1/api-keys', {label: 'Disposable XMR invoices',
    permissions: ['btcpay.store.cancreateinvoice:' + store.id, 'btcpay.store.canviewinvoices:' + store.id]});
  assert.ok(key.apiKey);
  providerToken = key.apiKey;
  stage = 'provider_xmr_settings'; save();
  await bounded(async () => {
    await providerPage.goto(providerBase + '/stores/' + store.id + '/monerolike/XMR');
    return await providerPage.locator('#Enabled').count() === 1;
  }, 180);
  await providerPage.locator('#Enabled').check();
  await providerPage.locator('#AccountIndex').selectOption('0');
  await providerPage.locator('#SettlementConfirmationThresholdChoice').selectOption('3');
  await providerPage.locator('#SaveButton').click();
  await providerPage.waitForLoadState('networkidle');
  await providerPage.reload();
  assert.equal(await providerPage.locator('#Enabled').isChecked(), true);
  assert.equal(await providerPage.locator('#SettlementConfirmationThresholdChoice').inputValue(), '3');
  const connection = {url: 'http://' + providerHost, storeId: store.id, apiKey: key.apiKey, assets: ['XMR']};
  pass('real_provider_store_xmr_enabled_ten_confirmations');
  await providerBrowser.close(); providerBrowser = null;

  stage = 'market_registration'; save();
  startMarket();
  await bounded(() => marketReady(host), 90);
  browser = await chromium.launch({executablePath, headless: true, chromiumSandbox: true,
    proxy: {server: 'socks5://127.0.0.1:43889'}});
  const users = {};
  let runtimeErrors = 0;
  report.browserRuntimeErrors = 0;
  for (const role of ['seller', 'buyer', 'admin']) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    const page = await context.newPage();
    page.setDefaultTimeout(90000);
    const started = Date.now();
    const diagnostic = {role, events: []};
    (report.registration ??= []).push(diagnostic);
    const record = fact => {
      if (!fact || diagnostic.events.length >= 40) return;
      diagnostic.events.push({...fact, elapsedMs: Date.now() - started}); save();
    };
    const request = r => record(registrationFact(origin, 'request', r.url()));
    const finished = r => record(registrationFact(origin, 'finished', r.url()));
    const failed = r => record(registrationFact(origin, 'failed', r.url()));
    const observeResponse = async r => {
      const fact = registrationFact(origin, 'response', r.url(), {status: r.status()});
      if (!fact) return;
      record(fact);
      try {record(registrationFact(origin, 'body', r.url(), {readable: true, body: await r.json()}));}
      catch {record(registrationFact(origin, 'body', r.url()));}
    };
    const navigation = frame => {
      if (frame === page.mainFrame()) record({event: 'navigation', path: registrationPage(origin, frame.url())});
    };
    page.on('request', request); page.on('requestfinished', finished);
    page.on('requestfailed', failed); page.on('response', observeResponse); page.on('framenavigated', navigation);
    page.on('pageerror', () => {runtimeErrors++; report.browserRuntimeErrors = runtimeErrors; save();});
    registrationCleanup = () => {
      page.off('request', request); page.off('requestfinished', finished);
      page.off('requestfailed', failed); page.off('response', observeResponse); page.off('framenavigated', navigation);
    };
    registrationSnapshot = async () => {
      diagnostic.page = registrationPage(origin, page.url());
      const headings = ['Welcome back', 'Create your account', 'Your account', 'Seller profile'];
      diagnostic.headings = Object.fromEntries(await Promise.all(headings.map(async name =>
        [name, await page.getByRole('heading', {name, exact: true}).isVisible()])));
      diagnostic.signOutVisible = await page.getByRole('button', {name: 'Sign out', exact: true}).isVisible();
      diagnostic.errorBoundaryVisible = await page.getByText('Something went wrong displaying this page. Reload to try again.', {exact: true}).isVisible();
      diagnostic.alertCount = await page.getByRole('alert').count();
      const cookie = (await context.cookies(origin)).find(c => c.name === 'market_session');
      diagnostic.sessionCookiePresent = Boolean(cookie);
      if (cookie) diagnostic.sessionCookie = {secure: cookie.secure, httpOnly: cookie.httpOnly,
        sameSite: ['Strict', 'Lax', 'None'].includes(cookie.sameSite) ? cookie.sameSite : 'other'};
      save();
    };
    stage = 'market_registration_' + role + '_form'; save();
    // Navigation can wait for Tor descriptor publication; registration itself is never retried.
    await bounded(async () => {await page.goto(origin + '/login', {timeout: 30000}); return await page.getByRole('button', {name: 'New here? Create an account', exact: true}).isVisible();}, 180);
    await page.getByRole('button', {name: 'New here? Create an account', exact: true}).click();
    await page.getByLabel('Username', {exact: true}).fill('trial_' + role);
    await page.locator('input[name="password"]').fill(credentials.marketPassword);
    stage = 'market_registration_' + role + '_submit'; save();
    const pending = page.waitForResponse(r => r.url().endsWith('/api/register') && r.request().method() === 'POST');
    await page.getByRole('button', {name: 'Create account', exact: true}).click();
    const response = await pending;
    assert.equal(response.status(), 200);
    const data = await response.json();
    users[role] = {context, page, csrf: data.csrf};
    diagnostic.registration = {status: response.status(), authenticated: Boolean(data.user),
      csrfPresent: typeof data.csrf === 'string' && data.csrf.length > 0};
    stage = 'market_registration_' + role + '_account'; save();
    await page.getByRole('heading', {name: 'Seller profile'}).waitFor();
    await registrationSnapshot();
    registrationCleanup(); registrationCleanup = registrationSnapshot = null;
  }
  pass('three_real_browser_accounts_through_tor');
  await stopMarket();
  admin(['promote', 'trial_admin']);
  admin(['connect', 'trial_seller', '-'], JSON.stringify(connection));
  startMarket();
  await bounded(() => marketReady(host), 60);
  const api = async (role, method, route, body) => users[role].page.evaluate(async ({method, route, body, csrf}) => {
    const r = await fetch('/api' + route, {method, headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}, body: body ? JSON.stringify(body) : undefined});
    const text = await r.text();
    let parsed; try {parsed = JSON.parse(text);} catch {parsed = text;}
    return {status: r.status, body: parsed, cacheControl: r.headers.get('cache-control')};
  }, {method, route, body, csrf: users[role].csrf});
  const ok = async (...args) => {const r = await api(...args); assert.ok(r.status < 300, 'Market API rejected operation'); return r.body;};

  stage = 'loopback_guard'; save();
  report.listeners = loopbackFacts(execFileSync('ss', ['-H', '-lnt'], {encoding: 'utf8', timeout: 5000}));
  save();
  for (const fact of report.listeners) {
    if (fact.required) assert.ok(fact.present, 'Missing required listener on port ' + fact.port);
    assert.ok(fact.loopbackOnly, 'Non-loopback listener on port ' + fact.port);
  }
  pass('all_test_services_listen_only_on_loopback');
  const listings = {}, orders = {};
  for (const kind of ['digital', 'physical']) {
    stage = kind + '_browser_listing'; save();
    const p = users.seller.page;
    await p.goto(origin + '/sell/new');
    await p.locator('select[name="kind"]').selectOption(kind);
    await p.locator('select[name="category"]').selectOption('Books & zines');
    await p.getByLabel('Product title').fill('Disposable XMR ' + kind);
    await p.locator('textarea[name="description"]').fill('Fictional isolated payment test; no real sale.');
    await p.locator('select[name="currency"]').selectOption('XMR');
    await p.getByLabel('Exact price per item').fill('0.1');
    await p.getByLabel('Available quantity').fill('3');
    if (kind === 'digital') {
      await p.getByLabel('Digital product file').setInputFiles({name: 'verification.txt', mimeType: 'text/plain', buffer: Buffer.from('Disposable XMR download verification.\n')});
    } else {
      await p.locator('input[name="shipping"]').fill('0.01');
      await p.locator('[name="ships_to"]').fill('Fictional test region');
    }
    await p.getByRole('checkbox').check();
    const created = p.waitForResponse(r => r.url().endsWith('/api/listings') && r.request().method() === 'POST');
    await p.getByRole('button', {name: 'Submit for review', exact: true}).click();
    const response = await created; assert.equal(response.status(), 201);
    listings[kind] = (await response.json()).id;
    const moderator = users.admin.page;
    await moderator.goto(origin + '/admin');
    const row = moderator.getByRole('row').filter({hasText: 'Disposable XMR ' + kind});
    await row.getByRole('button', {name: 'Approve', exact: true}).click();
    await row.getByText('Published', {exact: true}).waitFor();
    stage = kind + '_browser_order'; save();
    const buyer = users.buyer.page;
    await buyer.goto(origin + '/listing/' + listings[kind]);
    if (kind === 'physical') await buyer.locator('[name="address"]').fill('Fictional Buyer, 123 Example Street, Test Region');
    await buyer.getByRole('checkbox').check();
    const pending = buyer.waitForResponse(r => r.url().endsWith('/api/orders') && r.request().method() === 'POST', {timeout: 180000});
    await buyer.getByRole('button', {name: 'Create order', exact: true}).click();
    const placed = await pending; assert.equal(placed.status(), 201);
    orders[kind] = (await placed.json()).id;
    await buyer.getByRole('heading', {name: 'Payment & fulfillment'}).waitFor();
    assert.equal(await buyer.getByRole('link', {name: 'Open BTCPay invoice', exact: true}).isVisible(), true);
    const unpaid = await ok('buyer', 'GET', '/orders/' + orders[kind]);
    assert.equal(unpaid.order.currency, 'XMR');
    assert.equal(unpaid.order.total, kind === 'digital' ? '0.1' : '0.11');
    assert.equal(unpaid.order.status, 'awaiting_payment');
    assert.equal((await api('admin', 'GET', '/orders/' + orders[kind])).status, 404);
    if (kind === 'digital') assert.equal((await api('buyer', 'GET', '/orders/' + orders[kind] + '/download')).status, 403);
    pass(kind + '_real_invoice_created_and_unpaid_access_denied');

    stage = kind + '_fakechain_transfer'; save();
    const invoice = await providerApi('/api/v1/invoices/' + unpaid.order.payment_id);
    assert.equal(invoice.storeId, store.id);
    assert.equal(invoice.metadata.orderId, orders[kind]);
    assert.equal(invoice.currency, 'XMR');
    assert.equal(invoice.amount, unpaid.order.total);
    const methods = await providerApi('/api/v1/invoices/' + invoice.id + '/payment-methods');
    const method = methods.find(m => m.paymentMethodId === 'XMR-CHAIN');
    assert.ok(method?.destination && method.due);
    const atomic = BigInt(amount(method.due, 'XMR'));
    assert.ok(atomic > 0n && atomic <= 1_000_000_000_000n && atomic <= BigInt(Number.MAX_SAFE_INTEGER));
    await guardChain();
    await rpc(43888, 'refresh');
    const transfer = await rpc(43888, 'transfer', {destinations: [{address: method.destination, amount: Number(atomic)}], get_tx_key: false});
    assert.match(transfer.tx_hash, /^[a-f0-9]{64}$/);
    const mined = await mine(12, buyerAddress);
    for (const port of [43887, 43888]) await rpc(port, 'refresh');
    const notice = await fetch(providerBase + '/monerolikedaemoncallback/block?cryptoCode=xmr&hash=' + mined.blocks.at(-1), {signal: AbortSignal.timeout(30000)});
    assert.equal(notice.ok, true);
    stage = kind + '_settlement'; save();
    await bounded(async () => (await providerApi('/api/v1/invoices/' + invoice.id)).status === 'Settled', 180);
    const settledMethods = await providerApi('/api/v1/invoices/' + invoice.id + '/payment-methods');
    const settled = settledMethods.find(m => m.paymentMethodId === 'XMR-CHAIN');
    assert.equal(settled.payments.length, 1);
    assert.equal(settled.payments[0].status === 'Invalid', false);
    assert.equal(amount(settled.totalPaid, 'XMR'), atomic.toString());
    await ok('buyer', 'POST', '/orders/' + orders[kind] + '/refresh');
    const detail = await ok('buyer', 'GET', '/orders/' + orders[kind]);
    assert.equal(detail.order.status, kind === 'digital' ? 'fulfilled' : 'paid');
    if (kind === 'digital') {
      assert.equal((await api('seller', 'GET', '/orders/' + orders[kind] + '/download')).status, 403);
      const downloaded = await api('buyer', 'GET', '/orders/' + orders[kind] + '/download');
      assert.equal(downloaded.status, 200);
      assert.equal(downloaded.body, 'Disposable XMR download verification.\n');
      assert.equal(downloaded.cacheControl, 'no-store');
      await buyer.reload();
      const event = buyer.waitForEvent('download');
      await buyer.getByRole('link', {name: /Download/}).click();
      const download = await event;
      assert.equal(fs.readFileSync(await download.path(), 'utf8'), 'Disposable XMR download verification.\n');
      pass('xmr_digital_settled_exact_download_buyer_only_api_and_browser');
    } else {
      await p.goto(origin + '/orders/' + orders[kind]);
      await p.getByRole('button', {name: 'Mark shipped', exact: true}).waitFor();
      await p.locator('input[name="tracking"]').fill('Fictional carrier TRACK-TEST-123');
      await p.getByRole('button', {name: 'Mark shipped', exact: true}).click();
      await p.getByText('Shipped', {exact: true}).waitFor();
      await buyer.setViewportSize({width: 390, height: 844});
      await buyer.reload();
      await buyer.getByRole('button', {name: 'Confirm delivery received', exact: true}).click();
      await buyer.getByRole('heading', {name: 'Buyer feedback'}).waitFor();
      await buyer.locator('select[name="rating"]').selectOption('5');
      await buyer.getByLabel('Your experience').fill('Fictional review after isolated XMR settlement.');
      await buyer.getByRole('button', {name: 'Publish review', exact: true}).click();
      await buyer.getByText('Fictional review after isolated XMR settlement.', {exact: true}).waitFor();
      assert.equal(await buyer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal((await ok('buyer', 'GET', '/orders/' + orders[kind])).order.status, 'fulfilled');
      pass('xmr_physical_settled_browser_shipment_mobile_receipt_and_review');
    }
    report[kind] = {invoiceStatus: 'Settled', paymentCount: 1, amount: unpaid.order.total,
      providerDue: method.due, currency: 'XMR', confirmationBlocksGenerated: 12}; save();
  }
  await guardChain();
  assert.equal(runtimeErrors, 0);
  pass('no_browser_runtime_errors_and_fakechain_still_isolated');
  report.result = 'passed'; stage = 'complete'; save();
} catch (error) {
  try {
    const project = process.env.COMPOSE_PROJECT_NAME;
    assert.match(project, /^marketxmr[0-9]+a[0-9]+$/);
    assert.equal(project, 'marketxmr' + process.env.GITHUB_RUN_ID + 'a' + process.env.GITHUB_RUN_ATTEMPT);
    const ids = execFileSync('docker', ['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project],
      {encoding: 'utf8', timeout: 10000}).trim().split(/\s+/);
    assert.ok(ids.length > 0 && ids.length <= 8 && ids.every(id => /^[a-f0-9]{12,64}$/.test(id)));
    const format = '{{index .Config.Labels "com.docker.compose.service"}} {{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}';
    report.services = containerFacts(execFileSync('docker', ['inspect', '--format', format, ...ids],
      {encoding: 'utf8', timeout: 10000}));
  } catch {report.serviceStateUnavailable = true;}
  if (registrationSnapshot) {
    try {await Promise.race([registrationSnapshot(), delay(5000).then(() => {throw Error('Diagnostic deadline');})]);}
    catch {report.registrationSnapshotIncomplete = true;}
    registrationCleanup?.();
  }
  report.result = 'failed';
  report.failureType = error.name;
  report.failureSummary = String(error.message).split('\n')[0]
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[email]')
    .replace(/[A-Za-z0-9_+/=-]{20,}/g, '[value]').slice(0, 180);
  // Retain error detail only in the disposable runtime; never upload credentials or URLs.
  fs.writeFileSync(path.join(root, 'verify-private-error.log'), String(error.stack));
  save(); process.exitCode = 1;
} finally {
  await cleanup();
}
