'use strict';
const path = require('node:path');
const { domainToASCII } = require('node:url');
const { inspect } = require('./detector');
const { readDocument } = require('./document-readers');

const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

async function inspectOutlookMessage(message, policy, internalDomains) {
  const { sender, to, cc, bcc, subject, body, attachments } = message;
  const groups = [to, cc, bcc];
  if (!['audit', 'block'].includes(policy.mode) || !Array.isArray(policy.enabled) ||
      !groups.every(Array.isArray) || groups.flat().length > 500 ||
      typeof subject !== 'string' || subject.length > 4096 ||
      typeof body !== 'string' || body.length > 1024 * 1024 ||
      !Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) {
    throw new Error('Outlook denetim isteği geçersiz.');
  }
  const recipients = groups.flat();
  const domains = [sender, ...recipients].map(address => {
    if (typeof address !== 'string' || address.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(address)) {
      throw new Error('Outlook posta adresi çözümlenemedi.');
    }
    const domain = domainToASCII(address.split('@')[1]).toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(domain)) throw new Error('Outlook posta alan adı geçersiz.');
    return domain;
  });
  const knownDomains = new Set(internalDomains.map(domain => domainToASCII(domain).toLowerCase()));
  const externalRecipients = domains.slice(1).filter(domain => !knownDomains.has(domain)).length;
  const findings = new Set();
  if (policy.outlookExternalRecipients === true && externalRecipients > 0) findings.add('outlook_external_recipient');
  const scan = value => {
    for (const finding of inspect(value, policy.enabled)) findings.add(finding.type);
  };
  scan([sender, ...recipients, subject, body].join('\n'));

  let unreadableAttachments = 0;
  let totalBytes = 0;
  for (const attachment of attachments) {
    const { name, content } = attachment || {};
    if (typeof name !== 'string' || !name || name.length > 255) {
      unreadableAttachments++;
      continue;
    }
    scan(name);
    if (!Buffer.isBuffer(content)) {
      unreadableAttachments++;
      continue;
    }
    totalBytes += content.length;
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      unreadableAttachments++;
      continue;
    }
    try {
      scan(await readDocument(content, path.extname(name).toLowerCase()));
    } catch {
      unreadableAttachments++;
    }
  }
  const requiresAction = findings.size > 0 || unreadableAttachments > 0;
  return {
    decision: requiresAction ? (policy.mode === 'block' ? 'block' : 'warn') : 'allow',
    rules: [...findings],
    unreadableAttachments,
    externalRecipients
  };
}

async function inspectOutlookSubmission(message, policy, internalDomains) {
  if (!message || !Array.isArray(message.attachments) || message.attachments.length > MAX_ATTACHMENTS) {
    throw new Error('Outlook ek listesi geçersiz.');
  }
  let totalBytes = 0;
  const attachments = message.attachments.map(attachment => {
    if (!attachment || typeof attachment.name !== 'string') throw new Error('Outlook eki geçersiz.');
    if (attachment.unreadable === true) return { name: attachment.name };
    const encoded = attachment.base64;
    if (typeof encoded !== 'string' || encoded.length > 13981016 ||
        encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      return { name: attachment.name };
    }
    const content = Buffer.from(encoded, 'base64');
    if (content.toString('base64') !== encoded) return { name: attachment.name };
    totalBytes += content.length;
    if (totalBytes > MAX_ATTACHMENT_BYTES) return { name: attachment.name };
    return { name: attachment.name, content };
  });
  return inspectOutlookMessage({ ...message, attachments }, policy, internalDomains);
}

module.exports = { inspectOutlookMessage, inspectOutlookSubmission };
