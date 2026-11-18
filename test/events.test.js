'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { parser } = require('../lib/soap');
const { KindTracker, parsePullMessages } = require('../lib/events');

function note(topic, operation, state, itemName = 'State') {
  return (
    '<wsnt:NotificationMessage>'
    + `<wsnt:Topic Dialect="http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet">${topic}</wsnt:Topic>`
    + '<wsnt:Message>'
    + `<tt:Message UtcTime="2026-01-01T10:00:00Z" PropertyOperation="${operation}">`
    + '<tt:Source><tt:SimpleItem Name="Source" Value="000"/></tt:Source>'
    + `<tt:Data><tt:SimpleItem Name="${itemName}" Value="${state}"/></tt:Data>`
    + '</tt:Message></wsnt:Message></wsnt:NotificationMessage>'
  );
}

function pull(...notes) {
  const xml = (
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tev="http://www.onvif.org/ver10/events/wsdl" '
    + 'xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2" xmlns:tt="http://www.onvif.org/ver10/schema">'
    + `<s:Body><tev:PullMessagesResponse>${notes.join('')}</tev:PullMessagesResponse></s:Body></s:Envelope>`
  );
  return parser.parse(xml).Envelope.Body;
}

test('parsePullMessages handles a single notification', () => {
  const events = parsePullMessages(pull(note('tns1:RuleEngine/MyRuleDetector/Visitor', 'Changed', 'true')));
  assert.deepEqual(events, [{
    topic: 'RuleEngine/MyRuleDetector/Visitor',
    kind: 'doorbell',
    state: true,
    operation: 'Changed',
    time: '2026-01-01T10:00:00Z',
    source: { Source: '000' },
  }]);
});

test('parsePullMessages handles several notifications and unknown topics', () => {
  const events = parsePullMessages(pull(
    note('tns1:RuleEngine/CellMotionDetector/Motion', 'Initialized', 'false', 'IsMotion'),
    note('tns1:Something/Else', 'Changed', 'true'),
  ));
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'motion');
  assert.equal(events[0].state, false);
  assert.equal(events[1].kind, null);
});

test('parsePullMessages returns nothing for an empty response', () => {
  assert.deepEqual(parsePullMessages(pull()), []);
});

test('KindTracker reports only state changes', () => {
  const tracker = new KindTracker();
  const visitor = (operation, state) => ({ topic: 'RuleEngine/MyRuleDetector/Visitor', kind: 'doorbell', state, operation });
  assert.equal(tracker.update(visitor('Initialized', false)), null);
  assert.deepEqual(tracker.update(visitor('Changed', true)), { kind: 'doorbell', state: true, initial: false });
  assert.equal(tracker.update(visitor('Changed', true)), null);
  assert.deepEqual(tracker.update(visitor('Changed', false)), { kind: 'doorbell', state: false, initial: false });
});

test('KindTracker merges topics that share a kind', () => {
  const tracker = new KindTracker();
  const ev = (topic, state) => ({ topic, kind: 'vehicle', state, operation: 'Changed' });
  const car = 'RuleEngine/MyRuleDetector/VehicleDetect';
  const bike = 'RuleEngine/MyRuleDetector/Non_Motor_VehicleDetect';
  assert.deepEqual(tracker.update(ev(car, true)), { kind: 'vehicle', state: true, initial: false });
  assert.equal(tracker.update(ev(bike, true)), null);
  assert.equal(tracker.update(ev(car, false)), null);
  assert.deepEqual(tracker.update(ev(bike, false)), { kind: 'vehicle', state: false, initial: false });
});

test('KindTracker flags an initial true state', () => {
  const tracker = new KindTracker();
  const result = tracker.update({ topic: 'RuleEngine/MyRuleDetector/Visitor', kind: 'doorbell', state: true, operation: 'Initialized' });
  assert.deepEqual(result, { kind: 'doorbell', state: true, initial: true });
});

test('KindTracker ignores unknown kinds', () => {
  assert.equal(new KindTracker().update({ topic: 'x', kind: null, state: true }), null);
});
