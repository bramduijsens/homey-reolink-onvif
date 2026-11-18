'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { test } = require('node:test');

const { SoapFault, buildEnvelope, call, securityHeader } = require('../lib/soap');

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

test('securityHeader builds a PasswordDigest from nonce, created and password', () => {
  const nonce = Buffer.from('0123456789abcdef');
  const created = '2026-01-01T00:00:00Z';
  const xml = securityHeader({ username: 'user', password: 'secret', nonce, created });
  const expected = crypto
    .createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created), Buffer.from('secret')]))
    .digest('base64');
  assert.ok(xml.includes(`>${expected}</wsse:Password>`));
  assert.ok(xml.includes(`>${nonce.toString('base64')}</wsse:Nonce>`));
  assert.ok(!xml.includes('secret'));
});

test('securityHeader applies the device clock offset', () => {
  const xml = securityHeader({ username: 'u', password: 'p', offsetMs: 3600 * 1000 });
  const created = /<wsu:Created>([^<]+)<\/wsu:Created>/.exec(xml)[1];
  const diff = Date.parse(created) - Date.now();
  assert.ok(Math.abs(diff - 3600 * 1000) < 5000);
});

test('buildEnvelope escapes the username and adds addressing headers', () => {
  const xml = buildEnvelope('<x/>', {
    security: { username: 'a<b', password: 'p' },
    action: 'urn:act',
    to: 'http://device/x',
  });
  assert.ok(xml.includes('a&lt;b'));
  assert.ok(xml.includes('<wsa:Action s:mustUnderstand="1">urn:act</wsa:Action>'));
  assert.ok(xml.includes('<wsa:To s:mustUnderstand="1">http://device/x</wsa:To>'));
});

test('call returns the parsed body without namespace prefixes', async () => {
  const { server, url } = await serve((req, res) => {
    res.end('<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><tds:R xmlns:tds="urn:x"><tds:Model>M1</tds:Model></tds:R></s:Body></s:Envelope>');
  });
  try {
    const body = await call(url, '<x/>');
    assert.equal(body.R.Model, 'M1');
  } finally {
    server.close();
  }
});

test('call throws a SoapFault with the reason and subcode', async () => {
  const { server, url } = await serve((req, res) => {
    res.statusCode = 400;
    res.end(
      '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault>'
      + '<s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>ter:NotAuthorized</s:Value></s:Subcode></s:Code>'
      + '<s:Reason><s:Text xml:lang="en">Sender not authorized</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>',
    );
  });
  try {
    await assert.rejects(call(url, '<x/>'), (err) => {
      assert.ok(err instanceof SoapFault);
      assert.equal(err.message, 'Sender not authorized');
      assert.equal(err.code, 'ter:NotAuthorized');
      assert.equal(err.status, 400);
      return true;
    });
  } finally {
    server.close();
  }
});

test('call rejects on timeout', async () => {
  const { server, url } = await serve(() => {});
  try {
    await assert.rejects(call(url, '<x/>', { timeoutMs: 50 }), /timed out/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
