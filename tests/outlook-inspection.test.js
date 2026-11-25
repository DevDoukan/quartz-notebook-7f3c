'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectOutlookMessage } = require('../outlook-inspection');

const message = {
  sender: 'sender@corp.example', to: ['internal@corp.example'], cc: [],
  bcc: ['hidden@external.example'], subject: 'Merhaba', body: 'Toplantı bilgisi', attachments: []
};
const policy = { mode: 'block', enabled: ['confidential'] };

test('Outlook inspection counts external Bcc and returns a content-free decision', async () => {
  const domains = ['CORP.example'];
  assert.deepEqual(await inspectOutlookMessage(message, policy, domains), {
    decision: 'allow', rules: [], unreadableAttachments: 0, externalRecipients: 1
  });
  for (const change of [
    { subject: 'confidential' },
    { body: 'confidential' },
    { attachments: [{ name: 'data.txt', content: Buffer.from('confidential') }] }
  ]) {
    assert.deepEqual(await inspectOutlookMessage({ ...message, ...change }, policy, domains), {
      decision: 'block', rules: ['confidential'], unreadableAttachments: 0, externalRecipients: 1
    });
  }
});

test('Outlook inspection treats unavailable or unsupported attachments as unreadable', async () => {
  const input = { ...message, attachments: [
    { name: 'confidential cloud.docx' }, { name: 'unsupported.dat', content: Buffer.from('hello') }
  ] };
  for (const [mode, decision] of [['block', 'block'], ['audit', 'warn']]) {
    assert.deepEqual(await inspectOutlookMessage(input, { ...policy, mode }, ['corp.example']), {
      decision, rules: ['confidential'], unreadableAttachments: 2, externalRecipients: 1
    });
  }
  await assert.rejects(inspectOutlookMessage({ ...message, bcc: ['unresolved'] }, policy, []), /çözümlenemedi/);
});

test('Outlook external recipient policy applies to To, Cc and Bcc', async () => {
  const internal = { ...message, bcc: [] };
  const enabled = { ...policy, outlookExternalRecipients: true };
  const domains = ['corp.example'];
  assert.equal((await inspectOutlookMessage(internal, enabled, domains)).decision, 'allow');

  for (const field of ['to', 'cc', 'bcc']) {
    const external = { ...internal, [field]: ['recipient@external.example'] };
    const blocked = await inspectOutlookMessage(external, enabled, domains);
    assert.equal(blocked.decision, 'block');
    assert.deepEqual(blocked.rules, ['outlook_external_recipient']);
    assert.equal((await inspectOutlookMessage(external, { ...enabled, mode: 'audit' }, domains)).decision, 'warn');
    assert.equal((await inspectOutlookMessage(external, policy, domains)).decision, 'allow');
  }
});
