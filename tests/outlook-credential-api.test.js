'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { openCentral } = require('../central-store');
const { createCentralApp } = require('../central-server');

test('HTTPS issues an Outlook credential that cannot access general agent APIs', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kalkan-outlook-api-'));
  const store = openCentral(directory);
  const company = store.createTenant('owner', 'Company');
  store.setPolicy('owner', company.id, { mode: 'block', enabled: ['confidential'] });
  const device = store.enroll(store.issueEnrollment('owner', company.id).token, 'PC');
  store.close();
  const cert = fs.readFileSync(path.join(__dirname, 'fixtures/central-test-cert.pem'));
  const key = fs.readFileSync(path.join(__dirname, 'fixtures/central-test-key.pem'));
  const app = createCentralApp({
    dataDir: directory, publicOrigin: 'https://localhost:4417', tls: { cert, key }
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  function request(route, token, body = {}) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: '127.0.0.1', port: app.server.address().port, path: route,
        method: 'POST', ca: cert,
        headers: { Host: 'localhost:4417', 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
      }, res => {
        let text = '';
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }
  const issued = await request('/api/agent/outlook/credential', device.credential);
  assert.equal(issued.status, 200);
  assert.match(issued.body.credential, /^o1_[a-f0-9]{64}$/);
  const scoped = issued.body.credential;
  assert.equal((await request('/api/agent/outlook/renew', device.credential)).status,401);
  const decision = await request('/api/agent/outlook/inspect', scoped, {
    sender: 'sender@corp.example', to: ['recipient@example.org'], cc: [], bcc: [],
    subject: 'confidential', body: 'Private', attachments: []
  });
  assert.equal(decision.status, 200);
  assert.equal(decision.body.decision, 'block');
  assert.equal((await request('/api/agent/heartbeat', scoped)).status, 401);
  assert.equal((await request('/api/agent/outlook/credential', scoped)).status, 401);
  assert.equal((await request('/api/agent/events', scoped)).status, 401);
  await request('/api/agent/outlook/credential', device.credential);
  assert.equal((await request('/api/agent/outlook/inspect', scoped)).status, 401);
  for (const name of ['manifest.xml', 'runtime.js', 'runtime.html', 'status.html', 'icon-64.png', 'icon-128.png']) {
    const asset = await new Promise((resolve, reject) => {
      const req = https.get({
        hostname: '127.0.0.1', port: app.server.address().port, path: '/outlook/' + name,
        ca: cert, headers: { Host: 'localhost:4417', 'Sec-Fetch-Site': 'cross-site' }
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, bytes: Buffer.concat(chunks), headers: res.headers }));
      });
      req.on('error', reject);
    });
    assert.equal(asset.status, 200);
    assert.ok(asset.bytes.length > 0);
    assert.equal(asset.headers['cache-control'], 'no-store');
    assert.equal(asset.bytes.includes(Buffer.from(device.credential)), false);
    if (name === 'manifest.xml') assert.ok(asset.bytes.includes(Buffer.from('https://localhost:4417/outlook/runtime.js')));
  }
  const runtime = require('../tools/build-outlook-runtime.cjs').outlookRuntimeFiles('https://localhost:4417')['runtime.js'];
  const issuedForRuntime = await request('/api/agent/outlook/credential', device.credential);
  const session = { origin: 'https://localhost:4417', ...issuedForRuntime.body, expires: Date.now()+60000 };
  let handler, subject = 'confidential';
  const field = value => ({ getAsync: callback => callback({ status: 'succeeded', value }) });
  const item = {
    from: field({ emailAddress: 'sender@corp.example' }),
    to: field([{ emailAddress: 'recipient@example.org' }]), cc: field([]), bcc: field([]),
    subject: { getAsync: callback => callback({ status: 'succeeded', value: subject }) },
    body: { getAsync: (format, callback) => callback({ status: 'succeeded', value: 'Private message' }) },
    getAttachmentsAsync: callback => callback({ status: 'succeeded', value: [] }),
    sessionData: {
      getAsync: (name, callback) => callback({ status: 'succeeded', value: JSON.stringify(session) }),
      setAsync(name, value, callback) { Object.assign(session,JSON.parse(value));callback({ status:'succeeded' }); }
    }
  };
  const context = {
    URL, AbortController, setTimeout, clearTimeout,
    Office: {
      actions: { associate(name, callback) { handler = callback; } },
      context: { mailbox: { item }, requirements: { isSetSupported: () => false } }
    },
    fetch: async (url, options) => {
      const result = await request(new URL(url).pathname,
        options.headers.Authorization.slice('Bearer '.length), options.body?JSON.parse(options.body):{});
      return { ok: result.status === 200, json: async () => result.body };
    }
  };
  require('node:vm').runInNewContext(runtime, context);
  const completed = [];
  await handler({ completed: value => completed.push(value) });
  assert.equal(completed[0].allowEvent, false);
  assert.notEqual(session.credential,issuedForRuntime.body.credential);
  assert.ok(session.expires>Date.now()+2*60*1000);
  assert.equal((await request('/api/agent/outlook/inspect',issuedForRuntime.body.credential)).status,401);
  subject = 'Clean subject';
  await handler({ completed: value => completed.push(value) });
  assert.equal(completed[1].allowEvent, true);
  session.expires = 1;
  await handler({ completed: value => completed.push(value) });
  assert.equal(completed[2].allowEvent, false);
  const previousRuntimeCredential=session.credential;
  const renewed=await request('/api/agent/outlook/renew',previousRuntimeCredential);
  assert.equal(renewed.status,200);
  assert.match(renewed.body.credential,/^o1_[a-f0-9]{64}$/);
  assert.notEqual(renewed.body.credential,previousRuntimeCredential);
  assert.equal((await request('/api/agent/outlook/inspect',previousRuntimeCredential)).status,401);
  assert.equal((await request('/api/agent/heartbeat',renewed.body.credential)).status,401);
});
