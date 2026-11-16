'use strict';
const crypto = require('node:crypto');
const { inspectOutlookSubmission } = require('./outlook-inspection');

async function inspectRegisteredOutlookMessage(central, credential, message) {
  const initial = central.heartbeat(credential);
  if (!initial.policy) throw new Error('Outlook için şirket politikası yayımlanmamış.');
  const result = await inspectOutlookSubmission(message, initial.policy, initial.policy.internalDomains || []);
  const current = central.heartbeat(credential);
  if (current.policy?.revision !== initial.policy.revision) {
    throw new Error('Denetim sırasında şirket politikası değişti. Yeniden deneyin.');
  }
  central.ingest(credential, {
    id: crypto.randomUUID(), kind: 'outlook',
    decision: result.decision,
    count: result.rules.length + result.unreadableAttachments
  });
  return { ...result, policyRevision: initial.policy.revision };
}

module.exports = { inspectRegisteredOutlookMessage };
