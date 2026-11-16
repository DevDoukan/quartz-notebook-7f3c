'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleOutlookSend, createOutlookEvaluator, registerOutlookSend, outlookItemSessionLoader, setOutlookItemSession, renewableOutlookSessionLoader } = require('../outlook-send');
const { inspectOutlookSubmission } = require('../outlook-inspection');

function item() {
  const field = value => ({ getAsync: callback => callback({ status: 'succeeded', value }) });
  return {
    from: field({ emailAddress: 'sender@corp.example' }),
    to: field([{ emailAddress: 'recipient@corp.example' }]),
    cc: field([]), bcc: field([]), subject: field('Merhaba'),
    body: { getAsync: (type, callback) => callback({ status: 'succeeded', value: 'İleti' }) },
    getAttachmentsAsync: callback => callback({ status: 'succeeded', value: [] })
  };
}

test('Outlook item session accepts only a short scoped identity for the expected company', async () => {
  let saved;
  const office = { context: { mailbox: { item: { sessionData: {
    setAsync(key, value, callback) { saved = value; callback({ status: 'succeeded' }); },
    getAsync(key, callback) { callback({ status: 'succeeded', value: saved }); }
  } } } } };
  const session = { origin: 'https://company.example', credential: 'o1_'+'a'.repeat(64), expires: Date.now()+60000 };
  await setOutlookItemSession(office, session.origin, session);
  assert.deepEqual(await outlookItemSessionLoader(office, session.origin)(), session);
  for (const change of [
    { origin: 'https://other.example' }, { credential: 'a'.repeat(64) },
    { expires: 1 }, { expires: Date.now()+3600000 }
  ]) await assert.rejects(setOutlookItemSession(office, session.origin, { ...session, ...change }), /geçersiz/);
  await assert.rejects(outlookItemSessionLoader(office, 'https://other.example')(), /uyuşmuyor/);
});

test('Outlook renews a nearly expired session and saves the rotated scoped identity', async () => {
  let saved = { origin: 'https://company.example', credential: 'o1_'+'a'.repeat(64), expires: Date.now()+60000 };
  let requests = 0;
  const office = { context: { mailbox: { item: { sessionData: {
    getAsync(key, callback) { callback({ status: 'succeeded', value: JSON.stringify(saved) }); },
    setAsync(key, value, callback) { saved=JSON.parse(value); callback({ status: 'succeeded' }); }
  } } } } };
  const loader=renewableOutlookSessionLoader(office,saved.origin,async (url,options)=>{
    requests++;
    assert.equal(url,'https://company.example/api/agent/outlook/renew');
    assert.equal(options.headers.Authorization,'Bearer o1_'+'a'.repeat(64));
    assert.equal(options.redirect,'error');
    return {ok:true,json:async()=>({credential:'o1_'+'b'.repeat(64),expires:Date.now()+600000})};
  });
  assert.equal((await loader()).credential,'o1_'+'b'.repeat(64));
  assert.equal(saved.credential,'o1_'+'b'.repeat(64));
  await loader();
  assert.equal(requests,1);
  saved.expires=1;
  await assert.rejects(loader(),/yeniden/);
  assert.equal(requests,1);
});

test('Outlook send permits only an explicit allow result', async () => {
  for (const decision of ['allow', 'block', 'warn', undefined]) {
    const completed = [];
    await handleOutlookSend({ completed: value => completed.push(value) }, item(), async message => {
      assert.equal(message.sender, 'sender@corp.example');
      return { decision };
    });
    assert.equal(completed.length, 1);
    assert.equal(completed[0].allowEvent, decision === 'allow');
  }
});

test('Outlook send stops on a failed field read or service timeout', async () => {
  const broken = item();
  broken.from.getAsync = callback => callback({ status: 'failed' });
  for (const [message, evaluate] of [
    [broken, async () => { throw new Error('Must not evaluate'); }],
    [item(), () => new Promise(() => {})]
  ]) {
    const completed = [];
    await handleOutlookSend({ completed: value => completed.push(value) }, message, evaluate, 10);
    assert.equal(completed.length, 1);
    assert.equal(completed[0].allowEvent, false);
  }
});

test('Outlook collected attachment reaches the shared detector and blocks the send', async () => {
  const message = item();
  const content = Buffer.from('confidential').toString('base64');
  message.getAttachmentsAsync = callback => callback({
    status: 'succeeded', value: [{ id: 'attachment-1', name: 'data.txt', size: 12 }]
  });
  message.getAttachmentContentAsync = (id, callback) => {
    assert.equal(id, 'attachment-1');
    callback({ status: 'succeeded', value: { format: 'base64', content } });
  };
  const completed = [];
  await handleOutlookSend({ completed: value => completed.push(value) }, message,
    submission => inspectOutlookSubmission(submission,
      { mode: 'block', enabled: ['confidential'] }, ['corp.example']));
  assert.equal(completed.length, 1);
  assert.equal(completed[0].allowEvent, false);
});

test('Outlook invalid encoded content cannot receive a clean decision', async () => {
  for (const base64 of ['bad!', 'Zh==', undefined]) {
    const result = await inspectOutlookSubmission({
      sender: 'sender@corp.example', to: [], cc: [], bcc: [],
      subject: '', body: '', attachments: [{ name: 'data.txt', base64 }]
    }, { mode: 'block', enabled: ['confidential'] }, ['corp.example']);
    assert.equal(result.decision, 'block');
    assert.equal(result.unreadableAttachments, 1);
  }
});

test('Outlook timeout prevents a delayed field callback from sending content for evaluation', async () => {
  const message = item();
  let finishRead;
  message.from.getAsync = callback => { finishRead = callback; };
  let evaluations = 0;
  const completed = [];
  await handleOutlookSend({ completed: value => completed.push(value) }, message,
    async () => { evaluations++; return { decision: 'allow' }; }, 10);
  finishRead({ status: 'succeeded', value: { emailAddress: 'sender@corp.example' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(evaluations, 0);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].allowEvent, false);
});

test('Outlook evaluation receives cancellation when its send check expires', async () => {
  let signal;
  const completed = [];
  await handleOutlookSend({ completed: value => completed.push(value) }, item(),
    (message, cancellation) => {
      signal = cancellation;
      return new Promise(() => {});
    }, 10);
  assert.equal(signal.aborted, true);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].allowEvent, false);
});

test('Outlook evaluator binds content to HTTPS company endpoint without cookies or redirects', async () => {
  const credential = 'o1_' + 'a'.repeat(64);
  assert.throws(() => createOutlookEvaluator('https://corp.example', 'a'.repeat(64)), /geçersiz/);
  for (const origin of ['http://corp.example', 'https://user@corp.example', 'https://corp.example/path']) {
    assert.throws(() => createOutlookEvaluator(origin, credential), /geçersiz/);
  }
  const controller = new AbortController();
  const evaluate = createOutlookEvaluator('https://corp.example:9443', credential, async (url, options) => {
    assert.equal(url, 'https://corp.example:9443/api/agent/outlook/inspect');
    assert.equal(options.headers.Authorization, 'Bearer ' + credential);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal, controller.signal);
    return { ok: true, json: async () => ({ decision: 'block', policyRevision: 3 }) };
  });
  assert.equal((await evaluate({ subject: 'Test' }, controller.signal)).decision, 'block');
  controller.abort();
  await assert.rejects(evaluate({}, controller.signal), { name: 'AbortError' });
  const invalid = createOutlookEvaluator('https://corp.example', credential,
    async () => ({ ok: true, json: async () => ({ decision: 'allow' }) }));
  await assert.rejects(invalid({}), /geçersiz/);
});

test('Outlook warning override is restricted to warning decisions on supported clients', async () => {
  for (const supportsOverride of [true, false]) {
    for (const decision of ['warn', 'block']) {
      const completed = [];
      await handleOutlookSend({ completed: value => completed.push(value) }, item(),
        async () => ({ decision }), 1000, supportsOverride);
      assert.equal(completed.length, 1);
      assert.equal(completed[0].allowEvent, false);
      assert.equal(completed[0].sendModeOverride,
        decision === 'warn' && supportsOverride ? 'promptUser' : undefined);
    }
  }
});

test('Office event registration requires a live scoped session before contacting the company', async () => {
  let handler;
  let requests = 0;
  let session = { origin: 'https://corp.example', credential: 'o1_' + 'a'.repeat(64), expires: Date.now() + 60000 };
  const office = {
    actions: { associate(name, callback) { assert.equal(name, 'kalkanOnMessageSend'); handler = callback; } },
    context: { mailbox: { item: item() }, requirements: { isSetSupported: () => true } }
  };
  registerOutlookSend(office, async () => session, async () => {
    requests++;
    return { ok: true, json: async () => ({ decision: 'allow', policyRevision: 1 }) };
  });
  let result;
  await handler({ completed(value) { result = value; } });
  assert.equal(result.allowEvent, true);
  assert.equal(requests, 1);
  session = { ...session, expires: 1 };
  await handler({ completed(value) { result = value; } });
  assert.equal(result.allowEvent, false);
  assert.equal(requests, 1);
  session = null;
  await handler({ completed(value) { result = value; } });
  assert.equal(result.allowEvent, false);
  assert.equal(requests, 1);
});

test('Outlook cannot use a clean decision after the subject or attachment changed', async () => {
  for (const change of ['subject', 'attachment']) {
    const message = item();
    let subject = 'Clean';
    let content = Buffer.from('Clean').toString('base64');
    message.subject.getAsync = callback => callback({ status: 'succeeded', value: subject });
    message.getAttachmentsAsync = callback => callback({
      status: 'succeeded', value: [{ id: 'file', name: 'data.txt', size: 12 }]
    });
    message.getAttachmentContentAsync = (id, callback) => callback({
      status: 'succeeded', value: { format: 'base64', content }
    });
    const completed = [];
    await handleOutlookSend({ completed: value => completed.push(value) }, message, async () => {
      if (change === 'subject') subject = 'confidential';
      else content = Buffer.from('confidential').toString('base64');
      return { decision: 'allow' };
    });
    assert.equal(completed.length, 1);
    assert.equal(completed[0].allowEvent, false);
  }
});
