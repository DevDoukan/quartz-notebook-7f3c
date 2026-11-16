'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { buildOutlookRuntime } = require('../tools/build-outlook-runtime.cjs');

test('generated Office runtime registers the handler and rejects a missing item session', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'kalkan-outlook-runtime-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const output = path.join(parent, 'outlook');
  buildOutlookRuntime('https://company.example', output);
  const manifest = fs.readFileSync(path.join(output, 'manifest.xml'), 'utf8');
  const resources = [...manifest.matchAll(/https:\/\/company\.example\/outlook\/([^"]+)/g)];
  assert.ok(resources.length >= 5);
  for (const resource of resources) assert.ok(fs.statSync(path.join(output, resource[1])).isFile());
  let handler;
  const field = value => ({ getAsync: callback => callback({ status: 'succeeded', value }) });
  const item = {
    from: field({ emailAddress: 'sender@company.example' }), to: field([]), cc: field([]), bcc: field([]),
    subject: field('Test'), body: { getAsync: (format, callback) => callback({ status: 'succeeded', value: '' }) },
    getAttachmentsAsync: callback => callback({ status: 'succeeded', value: [] }),
    sessionData: { getAsync: (key, callback) => callback({ status: 'succeeded', value: null }) }
  };
  const context = {
    URL, AbortController, setTimeout, clearTimeout,
    fetch: () => { throw new Error('Must not contact server'); },
    Office: {
      actions: { associate(name, callback) { assert.equal(name, 'kalkanOnMessageSend'); handler = callback; } },
      context: { mailbox: { item }, requirements: { isSetSupported: () => false } }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(output, 'runtime.js'), 'utf8'), context);
  const completed = [];
  await handler({ completed: result => completed.push(result) });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].allowEvent, false);
  assert.throws(() => buildOutlookRuntime('https://company.example', output), /EEXIST/);
});

test('Outlook task pane imports only the expected company session and clears the selected file', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'kalkan-outlook-pane-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const output = path.join(parent, 'outlook');
  buildOutlookRuntime('https://company.example', output);
  let changed, saved;
  const input = { files: [], value: '', disabled: false, addEventListener(name, callback) { changed = callback; } };
  const status = { textContent: '' };
  const context = {
    URL, AbortController, setTimeout, clearTimeout,
    document: { getElementById: id => id === 'session-file' ? input : status },
    Office: {
      onReady: callback => callback(),
      context: { mailbox: { item: { sessionData: {
        setAsync(key, value, callback) { saved = JSON.parse(value); callback({ status: 'succeeded' }); }
      } } } }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(output, 'session-ui.js'), 'utf8'), context);
  const session = { origin: 'https://company.example', credential: 'o1_'+'a'.repeat(64), expires: Date.now()+60000 };
  input.files = [{ size: 200, text: async () => JSON.stringify(session) }];
  await changed();
  assert.equal(saved.credential, session.credential);
  assert.equal(status.textContent.includes(session.credential), false);
  assert.equal(input.value, '');
  assert.equal(input.disabled, false);
  saved = null;
  input.files = [{ size: 200, text: async () => JSON.stringify({ ...session, origin: 'https://other.example' }) }];
  await changed();
  assert.equal(saved, null);
  assert.match(status.textContent, /kurulamadı/);
});
