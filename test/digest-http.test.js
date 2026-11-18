'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');

const { buildDigestHeader, digestGet, parseChallenge } = require('../lib/digest-http');

test('buildDigestHeader matches the RFC 2617 example', () => {
  const challenge = {
    realm: 'testrealm@host.com',
    nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
    qop: 'auth,auth-int',
    opaque: '5ccc069c403ebaf9f0171e9517f40e41',
  };
  const header = buildDigestHeader({
    method: 'GET',
    uri: '/dir/index.html',
    username: 'Mufasa',
    password: 'Circle Of Life',
    challenge,
    nc: '00000001',
    cnonce: '0a4f113b',
  });
  assert.ok(header.includes('response="6629fae49393a05397450978507c4ef1"'));
});

test('parseChallenge reads quoted and bare parameters', () => {
  const params = parseChallenge('Digest realm="cam", qop="auth", nonce="abc", algorithm=MD5');
  assert.equal(params.realm, 'cam');
  assert.equal(params.nonce, 'abc');
  assert.equal(params.algorithm, 'MD5');
  assert.equal(parseChallenge('Basic realm="x"'), null);
});

function digestServer() {
  const challenge = 'Digest realm="cam", qop="auth", nonce="n0nce"';
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (!req.headers.authorization) {
        res.writeHead(401, { 'WWW-Authenticate': challenge });
        res.end();
        return;
      }
      const sent = /response="([^"]+)"/.exec(req.headers.authorization)[1];
      const cnonce = /cnonce="([^"]+)"/.exec(req.headers.authorization)[1];
      const expected = buildDigestHeader({
        method: 'GET',
        uri: req.url,
        username: 'user',
        password: 'pw',
        challenge: parseChallenge(challenge),
        cnonce,
      });
      if (!expected.includes(`response="${sent}"`)) {
        res.writeHead(401, { 'WWW-Authenticate': challenge });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(Buffer.from([0xff, 0xd8, 0xff]));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/snap?channel=0` }));
  });
}

test('digestGet answers a digest challenge', async () => {
  const { server, url } = await digestServer();
  try {
    const { body, contentType } = await digestGet(url, { username: 'user', password: 'pw' });
    assert.deepEqual([...body], [0xff, 0xd8, 0xff]);
    assert.equal(contentType, 'image/jpeg');
  } finally {
    server.close();
  }
});

test('digestGet fails on wrong credentials', async () => {
  const { server, url } = await digestServer();
  try {
    await assert.rejects(digestGet(url, { username: 'user', password: 'nope' }), /HTTP 401/);
  } finally {
    server.close();
  }
});

test('digestGet enforces the size limit', async () => {
  const { server, url } = await digestServer();
  try {
    await assert.rejects(digestGet(url, { username: 'user', password: 'pw', maxBytes: 2 }), /larger than/);
  } finally {
    server.close();
  }
});
