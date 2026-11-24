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
