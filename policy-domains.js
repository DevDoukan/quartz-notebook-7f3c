'use strict';
const { domainToASCII } = require('node:url');

function normalizeInternalDomains(domains) {
  if (!Array.isArray(domains) || domains.length > 100) throw new Error('Şirket alan adı listesi geçersiz.');
  return [...new Set(domains.map(value => {
    if (typeof value !== 'string' || value.length > 253 || /[\s/:@?#\\*]/.test(value.trim())) {
      throw new Error('Şirket alan adı geçersiz.');
    }
    const domain = domainToASCII(value.trim()).toLowerCase();
    if (!domain.includes('.') || domain.length > 253 ||
        domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      throw new Error('Şirket alan adı geçersiz.');
    }
    return domain;
  }))];
}

module.exports = { normalizeInternalDomains };
