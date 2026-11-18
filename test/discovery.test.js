'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { parseProbeMatch } = require('../lib/discovery');

function probeMatch(xaddrs, scopes) {
  return (
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">'
    + `<s:Body><d:ProbeMatches><d:ProbeMatch><d:Scopes>${scopes}</d:Scopes><d:XAddrs>${xaddrs}</d:XAddrs></d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>`
  );
}

test('parseProbeMatch reads host, port, name and hardware', () => {
  const xml = probeMatch(
    'http://192.0.2.10:8000/onvif/device_service',
    'onvif://www.onvif.org/name/Front%20Door onvif://www.onvif.org/hardware/D340B onvif://www.onvif.org/location/country/x',
  );
  assert.deepEqual(parseProbeMatch(xml), { host: '192.0.2.10', port: 8000, name: 'Front Door', hardware: 'D340B' });
});

test('parseProbeMatch skips non-IPv4 addresses and defaults the port', () => {
  const xml = probeMatch('http://[fe80::1]/onvif/device_service http://192.0.2.11/onvif/device_service', '');
  assert.deepEqual(parseProbeMatch(xml), { host: '192.0.2.11', port: 80, name: undefined, hardware: undefined });
});

test('parseProbeMatch returns null for unusable input', () => {
  assert.equal(parseProbeMatch('not xml'), null);
  assert.equal(parseProbeMatch(probeMatch('', '')), null);
});
