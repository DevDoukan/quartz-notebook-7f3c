'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openCentral } = require('../central-store');
const { inspectRegisteredOutlookMessage } = require('../outlook-central');

test('Outlook uses the enrolled company policy and stores only decision metadata', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kalkan-outlook-'));
  const central = openCentral(directory);
  t.after(() => { central.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const first = central.createTenant('owner-a', 'A');
  const second = central.createTenant('owner-b', 'B');
  central.setPolicy('owner-a', first.id, { mode: 'block', enabled: ['confidential'], internalDomains: ['CORP.example'] });
  central.setPolicy('owner-b', second.id, { mode: 'audit', enabled: ['confidential'] });
  const device = central.enroll(central.issueEnrollment('owner-a', first.id).token, 'Outlook-PC');
  const message = {
    sender: 'sender@corp.example', to: ['recipient@example.org'], cc: [], bcc: [],
    subject: 'confidential', body: 'PRIVATE MESSAGE CONTENT', attachments: [],
    tenant: second.id, policy: { mode: 'audit', enabled: [] }
  };
  const result = await inspectRegisteredOutlookMessage(central, device.credential, message);
  assert.equal(result.decision, 'block');
  assert.equal(result.externalRecipients, 1);
  const internal = await inspectRegisteredOutlookMessage(central, device.credential,
    { ...message, to: ['colleague@corp.example'] });
  assert.equal(internal.externalRecipients, 0);
  central.setPolicy('owner-a', first.id, { mode: 'audit', enabled: ['confidential'] });
  assert.deepEqual(central.heartbeat(device.credential).policy.internalDomains, ['corp.example']);
  central.setPolicy('owner-a', first.id, { mode: 'block', enabled: ['confidential'], internalDomains: [] });
  assert.deepEqual(central.heartbeat(device.credential).policy.internalDomains, []);
  assert.equal(central.events('owner-b', second.id).length, 0);
  const events = central.events('owner-a', first.id);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0].data, { kind: 'outlook', decision: 'block', count: 1 });
  assert.equal(JSON.stringify(events).includes(message.body), false);
  central.revoke('owner-a', first.id, device.id);
  await assert.rejects(inspectRegisteredOutlookMessage(central, device.credential, message), /kimliği/);
});

test('company policy validates and normalizes internal email domains', () => {
  const { normalizeInternalDomains } = require('../policy-domains');
  assert.deepEqual(normalizeInternalDomains([' CORP.example ', 'corp.example']), ['corp.example']);
  for (const value of ['https://corp.example', '*.corp.example', 'corp.example/path', 'corp..example']) {
    assert.throws(() => normalizeInternalDomains([value]), /geçersiz/);
  }
});

test('Outlook scoped credentials expire, rotate and cannot authorize general agent calls', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kalkan-outlook-identity-'));
  let clock = 1000;
  const central = openCentral(directory, { now: () => clock });
  t.after(() => { central.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const company = central.createTenant('owner', 'Company');
  const device = central.enroll(central.issueEnrollment('owner', company.id).token, 'PC');
  const first = central.issueOutlookCredential(device.credential);
  assert.equal(central.heartbeat(first.credential, undefined, true).tenant, company.id);
  assert.throws(() => central.heartbeat(first.credential), /kimliği/);
  assert.throws(() => central.issueOutlookCredential(first.credential), /kimliği/);
  const second = central.issueOutlookCredential(device.credential);
  assert.throws(() => central.heartbeat(first.credential, undefined, true), /kimliği/);
  clock = second.expires;
  assert.throws(() => central.heartbeat(second.credential, undefined, true), /kimliği/);
  const third = central.issueOutlookCredential(device.credential);
  central.revoke('owner', company.id, device.id);
  assert.throws(() => central.heartbeat(third.credential, undefined, true), /kimliği/);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(directory, 'central.sqlite'));
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM outlook_credentials').get().n, 0);
  } finally {
    db.close();
  }
});

test('Outlook rechecks revocation and policy changes before recording a decision', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kalkan-outlook-race-'));
  const central = openCentral(directory);
  t.after(() => { central.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const company = central.createTenant('owner', 'Company');
  const device = central.enroll(central.issueEnrollment('owner', company.id).token, 'Outlook-PC');
  const message = {
    sender: 'sender@corp.example', to: ['recipient@corp.example'], cc: [], bcc: [],
    subject: 'Clean', body: 'Clean', attachments: []
  };
  await assert.rejects(inspectRegisteredOutlookMessage(central, device.credential, message), /yayımlanmamış/);
  central.setPolicy('owner', company.id, { mode: 'audit', enabled: [] });
  const changed = inspectRegisteredOutlookMessage(central, device.credential, message);
  central.setPolicy('owner', company.id, { mode: 'block', enabled: ['confidential'] });
  await assert.rejects(changed, /politika/);
  assert.equal(central.events('owner', company.id).length, 0);
  const revoked = inspectRegisteredOutlookMessage(central, device.credential, message);
  central.revoke('owner', company.id, device.id);
  await assert.rejects(revoked, /kimliği/);
  assert.equal(central.events('owner', company.id).length, 0);
});

test('Outlook renewal rotates its identity and cannot extend beyond the original eight hours', t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-outlook-renew-'));
  let clock=1000;
  const central=openCentral(directory,{now:()=>clock});
  t.after(()=>{central.close();fs.rmSync(directory,{recursive:true,force:true});});
  const company=central.createTenant('owner','Company');
  const device=central.enroll(central.issueEnrollment('owner',company.id).token,'PC');
  let session=central.issueOutlookCredential(device.credential);
  const deadline=clock+8*60*60*1000;
  while(clock<deadline){
    const previous=session;
    clock=Math.min(clock+14*60*1000,deadline-1);
    session=central.renewOutlookCredential(previous.credential);
    assert.ok(session.expires<=deadline);
    assert.throws(()=>central.heartbeat(previous.credential,undefined,true),/kimliği/);
    if(clock===deadline-1)break;
  }
  clock=deadline;
  assert.throws(()=>central.renewOutlookCredential(session.credential),/kimliği|yeniden/);
  assert.throws(()=>central.renewOutlookCredential(device.credential),/kimliği/);
});

test('legacy Outlook identities survive schema upgrade but require reauthorization before renewal', t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-outlook-upgrade-'));
  let central=openCentral(directory);
  t.after(()=>{central.close();fs.rmSync(directory,{recursive:true,force:true});});
  const company=central.createTenant('owner','Company');
  const device=central.enroll(central.issueEnrollment('owner',company.id).token,'PC');
  const session=central.issueOutlookCredential(device.credential);
  central.close();
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync(path.join(directory,'central.sqlite'));
  try{db.exec('ALTER TABLE outlook_credentials DROP COLUMN renew_until');}finally{db.close();}
  central=openCentral(directory);
  assert.equal(central.heartbeat(session.credential,undefined,true).tenant,company.id);
  assert.throws(()=>central.renewOutlookCredential(session.credential),/yeniden/);
  const current=central.issueOutlookCredential(device.credential);
  assert.match(central.renewOutlookCredential(current.credential).credential,/^o1_/);
});
