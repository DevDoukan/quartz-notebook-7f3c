'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SaxesParser } = require('saxes');
const { outlookManifest } = require('../tools/outlook-manifest.cjs');

test('company Outlook manifest binds runtime resources and blocking send event', () => {
  const xml = outlookManifest('https://dlp.company.example:9443');
  const tags = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on('opentag', tag => tags.push(tag));
  parser.write(xml).close();
  const productVersion = require('../package.json').version;
  const version = productVersion.includes('-rc.') ? productVersion.replace('-rc.', '.') : productVersion + '.0';
  assert.ok(xml.includes('<Version>' + version + '</Version>'));
  const launch = tags.find(tag => tag.local === 'LaunchEvent');
  assert.equal(launch.attributes.Type.value, 'OnMessageSend');
  assert.equal(launch.attributes.FunctionName.value, 'kalkanOnMessageSend');
  assert.equal(launch.attributes.SendMode.value, 'Block');
  const resources = tags.filter(tag => tag.local === 'Url');
  assert.equal(resources.length, 3);
  assert.ok(resources.every(tag => tag.attributes.DefaultValue.value.startsWith('https://dlp.company.example:9443/outlook/')));
  for (const origin of ['http://company.example', 'https://user@company.example', 'https://company.example/path']) {
    assert.throws(() => outlookManifest(origin), /HTTPS/);
  }
});
