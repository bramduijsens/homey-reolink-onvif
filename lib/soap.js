'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
});

const PASSWORD_DIGEST = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest';
const BASE64_BINARY = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary';

class SoapFault extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SoapFault';
    this.code = details.code;
    this.status = details.status;
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node) {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'object') return node['#text'];
  return String(node);
}

function securityHeader({ username, password, offsetMs = 0, nonce = crypto.randomBytes(16), created }) {
  const stamp = created || new Date(Date.now() + offsetMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const digest = crypto
    .createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(stamp), Buffer.from(password)]))
    .digest('base64');
  return (
    '<wsse:Security s:mustUnderstand="1" '
    + 'xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" '
    + 'xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">'
    + '<wsse:UsernameToken>'
    + `<wsse:Username>${escapeXml(username)}</wsse:Username>`
    + `<wsse:Password Type="${PASSWORD_DIGEST}">${digest}</wsse:Password>`
    + `<wsse:Nonce EncodingType="${BASE64_BINARY}">${nonce.toString('base64')}</wsse:Nonce>`
    + `<wsu:Created>${stamp}</wsu:Created>`
    + '</wsse:UsernameToken></wsse:Security>'
  );
}

function buildEnvelope(bodyXml, { security, action, to } = {}) {
  const headers = [];
  if (security) headers.push(securityHeader(security));
  if (action) headers.push(`<wsa:Action s:mustUnderstand="1">${escapeXml(action)}</wsa:Action>`);
  if (to) headers.push(`<wsa:To s:mustUnderstand="1">${escapeXml(to)}</wsa:To>`);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://www.w3.org/2005/08/addressing">'
    + `<s:Header>${headers.join('')}</s:Header>`
    + `<s:Body>${bodyXml}</s:Body></s:Envelope>`
  );
}

function post(url, xml, { timeoutMs = 8000, signal } = {}) {
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      target,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(xml),
        },
        signal,
        // Self-signed certificates are normal on cameras.
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => {
      reject(new Error(`Request timed out after ${timeoutMs} ms`));
      req.destroy();
    });
    req.on('error', reject);
    req.end(xml);
  });
}

function faultFrom(body, status) {
  const fault = body && body.Fault;
  if (!fault) return null;
  const reason = textOf(toArray(fault.Reason && fault.Reason.Text)[0]) || 'SOAP fault';
  const subcode = fault.Code && fault.Code.Subcode && textOf(fault.Code.Subcode.Value);
  return new SoapFault(reason, { code: subcode || textOf(fault.Code && fault.Code.Value), status });
}

// Returns the parsed SOAP Body (namespace prefixes removed); throws SoapFault or Error.
async function call(url, bodyXml, { security, action, to, timeoutMs, signal } = {}) {
  const { status, text } = await post(url, buildEnvelope(bodyXml, { security, action, to }), { timeoutMs, signal });
  let body;
  try {
    const parsed = parser.parse(text);
    body = parsed.Envelope && parsed.Envelope.Body;
  } catch (err) {
    throw new Error(`Invalid SOAP response (HTTP ${status})`);
  }
  const fault = faultFrom(body, status);
  if (fault) throw fault;
  if (status < 200 || status >= 300) throw new SoapFault(`HTTP ${status}`, { status });
  return body || {};
}

module.exports = { SoapFault, buildEnvelope, call, escapeXml, parser, securityHeader, textOf, toArray };
