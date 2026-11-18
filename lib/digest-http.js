'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');

function parseChallenge(header) {
  if (!header || !/^digest\s/i.test(header)) return null;
  const params = {};
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]*))/g;
  let match;
  while ((match = re.exec(header.slice(7))) !== null) params[match[1].toLowerCase()] = match[2] !== undefined ? match[2] : match[3];
  return params.nonce ? params : null;
}

function buildDigestHeader({ method, uri, username, password, challenge, nc = '00000001', cnonce = crypto.randomBytes(8).toString('hex') }) {
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = challenge.qop ? challenge.qop.split(',').map((q) => q.trim()).find((q) => q === 'auth') : undefined;
  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  parts.push('algorithm=MD5');
  return `Digest ${parts.join(', ')}`;
}

function get(url, headers, { timeoutMs, maxBytes, signal }) {
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(target, { method: 'GET', headers, signal, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          reject(new Error(`Response larger than ${maxBytes} bytes`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => {
      reject(new Error(`Request timed out after ${timeoutMs} ms`));
      req.destroy();
    });
    req.on('error', reject);
    req.end();
  });
}

// GET with HTTP digest auth; the 5 MB default matches the Homey image size limit.
async function digestGet(url, { username, password, timeoutMs = 8000, maxBytes = 5 * 1024 * 1024, signal } = {}) {
  const options = { timeoutMs, maxBytes, signal };
  let res = await get(url, {}, options);
  if (res.status === 401) {
    const challenge = parseChallenge(res.headers['www-authenticate']);
    if (!challenge) throw new Error('Server requires an unsupported authentication scheme');
    const target = new URL(url);
    const header = buildDigestHeader({ method: 'GET', uri: target.pathname + target.search, username, password, challenge });
    res = await get(url, { Authorization: header }, options);
  }
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return { body: res.body, contentType: res.headers['content-type'] };
}

module.exports = { buildDigestHeader, digestGet, parseChallenge };
