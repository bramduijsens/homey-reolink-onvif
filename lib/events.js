'use strict';

const { textOf, toArray } = require('./soap');

// Topics seen on Reolink doorbells; several topics can map to the same kind.
const TOPIC_KINDS = {
  'RuleEngine/CellMotionDetector/Motion': 'motion',
  'VideoSource/MotionAlarm': 'motion',
  'RuleEngine/MyRuleDetector/PeopleDetect': 'person',
  'RuleEngine/MyRuleDetector/VehicleDetect': 'vehicle',
  'RuleEngine/MyRuleDetector/Non_Motor_VehicleDetect': 'vehicle',
  'RuleEngine/MyRuleDetector/DogCatDetect': 'pet',
  'RuleEngine/MyRuleDetector/FaceDetect': 'face',
  'RuleEngine/MyRuleDetector/Package': 'package',
  'RuleEngine/MyRuleDetector/Visitor': 'doorbell',
};

function simpleItems(group) {
  const items = {};
  for (const item of toArray(group && group.SimpleItem)) items[item['@_Name']] = item['@_Value'];
  return items;
}

function normalizeTopic(topic) {
  return String(topic || '').trim().replace(/^[^:/]+:/, '');
}

// Turns a PullMessagesResponse body into [{ topic, kind, state, operation, time, source }].
function parsePullMessages(body) {
  const response = body && body.PullMessagesResponse;
  const events = [];
  for (const note of toArray(response && response.NotificationMessage)) {
    const message = note.Message && note.Message.Message;
    if (!message) continue;
    const topic = normalizeTopic(textOf(note.Topic));
    const data = simpleItems(message.Data);
    const first = Object.values(data)[0];
    events.push({
      topic,
      kind: TOPIC_KINDS[topic] || null,
      state: first === 'true' || first === '1',
      operation: message['@_PropertyOperation'],
      time: message['@_UtcTime'],
      source: simpleItems(message.Source),
    });
  }
  return events;
}

// Folds per-topic states into one state per kind and reports changes only.
class KindTracker {
  constructor() {
    this._topicStates = new Map();
    this._kindStates = new Map();
  }

  update(event) {
    if (!event.kind) return null;
    this._topicStates.set(event.topic, event.state);
    const state = Object.entries(TOPIC_KINDS).some(
      ([topic, kind]) => kind === event.kind && this._topicStates.get(topic) === true,
    );
    if ((this._kindStates.get(event.kind) || false) === state) return null;
    this._kindStates.set(event.kind, state);
    return { kind: event.kind, state, initial: event.operation === 'Initialized' };
  }
}

module.exports = { KindTracker, TOPIC_KINDS, parsePullMessages };
