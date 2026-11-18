'use strict';

const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { parser, toArray } = require('./soap');

const MULTICAST_ADDRESS = '239.255.255.250';
const WS_DISCOVERY_PORT = 3702;

function buildProbe() {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" '
    + 'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">'
    + `<e:Header><w:MessageID>uuid:${crypto.randomUUID()}</w:MessageID><w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>`
    + '<w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>'
    + '<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>'
  );
}

function scopeValue(scopes, key) {
  const match = new RegExp(`onvif://www\\.onvif\\.org/${key}/(\\S+)`).exec(scopes);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch (err) {
    return match[1];
  }
}

// Returns { host, port, name, hardware } for the first IPv4 XAddr of a ProbeMatch, or null.
function parseProbeMatch(xml) {
  let body;
  try {
    body = parser.parse(xml).Envelope.Body;
  } catch (err) {
    return null;
  }
  const match = toArray(body && body.ProbeMatches && body.ProbeMatches.ProbeMatch)[0];
  if (!match || typeof match.XAddrs !== 'string') return null;
  for (const addr of match.XAddrs.split(/\s+/)) {
    let url;
    try {
      url = new URL(addr);
    } catch (err) {
      continue;
    }
    if (url.protocol !== 'http:' || !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) continue;
    const scopes = typeof match.Scopes === 'string' ? match.Scopes : '';
    return {
      host: url.hostname,
      port: Number(url.port) || 80,
      name: scopeValue(scopes, 'name'),
      hardware: scopeValue(scopes, 'hardware'),
    };
  }
  return null;
}

function discover({ timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const found = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const finish = () => {
      clearTimeout(timer);
      socket.close();
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
    socket.on('message', (message) => {
      const device = parseProbeMatch(message.toString('utf8'));
      if (device && !found.has(device.host)) found.set(device.host, device);
    });
    socket.bind(0, () => {
      socket.send(buildProbe(), WS_DISCOVERY_PORT, MULTICAST_ADDRESS, (err) => {
        if (err) {
          clearTimeout(timer);
          socket.close();
          reject(err);
        }
      });
    });
  });
}

module.exports = { discover, parseProbeMatch };
