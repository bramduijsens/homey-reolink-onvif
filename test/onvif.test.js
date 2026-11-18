'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');

const { OnvifClient } = require('../lib/onvif');

function envelope(inner) {
  return `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>${inner}</s:Body></s:Envelope>`;
}

// Fake device: routes on the first element of the SOAP body.
function fakeDevice(responses) {
  const requests = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        requests.push(data);
        const op = /<s:Body>\s*<(?:\w+:)?(\w+)/.exec(data)[1];
        res.end(envelope(typeof responses[op] === 'function' ? responses[op](server) : responses[op]));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, port: server.address().port }));
  });
}

const base = (port) => `http://127.0.0.1:${port}`;

test('syncTime computes the offset to the device clock and signs later calls with it', async () => {
  const { server, requests, port } = await fakeDevice({
    GetSystemDateAndTime: '<tds:GetSystemDateAndTimeResponse xmlns:tds="urn:d"><tds:SystemDateAndTime><tt:UTCDateTime xmlns:tt="urn:t">'
      + '<tt:Time><tt:Hour>1</tt:Hour><tt:Minute>0</tt:Minute><tt:Second>0</tt:Second></tt:Time>'
      + '<tt:Date><tt:Year>2020</tt:Year><tt:Month>1</tt:Month><tt:Day>1</tt:Day></tt:Date>'
      + '</tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>',
    GetDeviceInformation: '<tds:GetDeviceInformationResponse xmlns:tds="urn:d"><tds:Manufacturer>Reolink</tds:Manufacturer>'
      + '<tds:Model>M</tds:Model><tds:FirmwareVersion>1</tds:FirmwareVersion><tds:SerialNumber>SN1</tds:SerialNumber></tds:GetDeviceInformationResponse>',
  });
  try {
    const client = new OnvifClient({ host: '127.0.0.1', port, username: 'u', password: 'p' });
    const offset = await client.syncTime();
    assert.ok(Math.abs(offset - (Date.UTC(2020, 0, 1, 1, 0, 0) - Date.now())) < 5000);
    assert.ok(!requests[0].includes('UsernameToken'));
    const info = await client.getDeviceInformation();
    assert.equal(info.serialNumber, 'SN1');
    assert.ok(requests[1].includes('UsernameToken'));
    assert.ok(requests[1].includes('<wsu:Created>2020-01-01T01:00:'));
  } finally {
    server.close();
  }
});

test('createPullPoint, pullMessages and unsubscribe use the advertised addresses', async () => {
  const { server, requests, port } = await fakeDevice({
    GetCapabilities: (srv) => `<tds:GetCapabilitiesResponse xmlns:tds="urn:d"><tds:Capabilities><tt:Events xmlns:tt="urn:t"><tt:XAddr>${base(srv.address().port)}/events</tt:XAddr></tt:Events></tds:Capabilities></tds:GetCapabilitiesResponse>`,
    CreatePullPointSubscription: (srv) => `<tev:CreatePullPointSubscriptionResponse xmlns:tev="urn:e" xmlns:wsa="urn:a"><tev:SubscriptionReference><wsa:Address>${base(srv.address().port)}/sub1</wsa:Address></tev:SubscriptionReference></tev:CreatePullPointSubscriptionResponse>`,
    PullMessages: '<tev:PullMessagesResponse xmlns:tev="urn:e"/>',
    Unsubscribe: '<wsnt:UnsubscribeResponse xmlns:wsnt="urn:w"/>',
  });
  try {
    const client = new OnvifClient({ host: '127.0.0.1', port, username: 'u', password: 'p' });
    const address = await client.createPullPoint(600);
    assert.equal(address, `${base(port)}/sub1`);
    assert.ok(requests.some((r) => r.includes('<tev:InitialTerminationTime>PT600S')));
    assert.deepEqual(await client.pullMessages(address, { timeoutSeconds: 1 }), []);
    await client.unsubscribe(address);
    assert.ok(requests.at(-1).includes(`<wsa:To s:mustUnderstand="1">${address}</wsa:To>`));
  } finally {
    server.close();
  }
});
