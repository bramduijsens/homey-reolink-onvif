'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');

const { Subscriber } = require('../lib/subscriber');

function fakeClient(overrides = {}) {
  const calls = [];
  const client = {
    calls,
    async createPullPoint() { calls.push('create'); return 'sub-1'; },
    async renew() { calls.push('renew'); },
    async pullMessages() { calls.push('pull'); await new Promise((r) => setTimeout(r, 5)); return []; },
    async unsubscribe(address) { calls.push(`unsubscribe:${address}`); },
    ...overrides,
  };
  return client;
}

const fast = { minBackoffMs: 5, maxBackoffMs: 20, pullTimeoutSeconds: 1 };

test('emits events from pullMessages and unsubscribes on stop', async () => {
  let delivered = false;
  const client = fakeClient({
    async pullMessages() {
      client.calls.push('pull');
      await new Promise((r) => setTimeout(r, 5));
      if (delivered) return [];
      delivered = true;
      return [{ topic: 't', kind: 'motion', state: true }];
    },
  });
  const sub = new Subscriber(client, fast);
  const received = once(sub, 'event');
  sub.start();
  const [event] = await received;
  assert.equal(event.kind, 'motion');
  await sub.stop();
  assert.equal(client.calls.filter((c) => c === 'create').length, 1);
  assert.ok(client.calls.includes('unsubscribe:sub-1'));
});

test('keeps one subscription across pull failures below the limit', async () => {
  let pulls = 0;
  const client = fakeClient({
    async pullMessages() {
      pulls += 1;
      if (pulls === 1) throw new Error('boom');
      await new Promise((r) => setTimeout(r, 5));
      return [];
    },
  });
  const sub = new Subscriber(client, { ...fast, maxPullFailures: 3 });
  const failed = once(sub, 'failure');
  sub.start();
  await failed;
  while (pulls < 3) await new Promise((r) => setTimeout(r, 5));
  await sub.stop();
  assert.equal(client.calls.filter((c) => c === 'create').length, 1);
});

test('resubscribes after repeated pull failures', async () => {
  let creates = 0;
  const client = fakeClient({
    async createPullPoint() { creates += 1; return `sub-${creates}`; },
    async pullMessages() {
      if (creates === 1) throw new Error('gone');
      await new Promise((r) => setTimeout(r, 5));
      return [];
    },
  });
  const sub = new Subscriber(client, { ...fast, maxPullFailures: 2 });
  sub.on('failure', () => {});
  sub.start();
  while (creates < 2) await new Promise((r) => setTimeout(r, 5));
  await sub.stop();
  assert.ok(client.calls.includes('unsubscribe:sub-1'));
});

test('backs off when subscribing fails and recovers', async () => {
  let attempts = 0;
  const client = fakeClient({
    async createPullPoint() {
      attempts += 1;
      if (attempts < 3) throw new Error('no free slot');
      return 'sub-ok';
    },
  });
  const sub = new Subscriber(client, fast);
  const failures = [];
  sub.on('failure', (err) => failures.push(err.message));
  const subscribed = once(sub, 'subscribed');
  sub.start();
  await subscribed;
  await sub.stop();
  assert.deepEqual(failures, ['no free slot', 'no free slot']);
});

test('renews when half of the TTL has passed', async () => {
  const client = fakeClient();
  const sub = new Subscriber(client, { ...fast, ttlSeconds: 0.02 });
  sub.start();
  while (!client.calls.includes('renew')) await new Promise((r) => setTimeout(r, 5));
  await sub.stop();
  assert.ok(client.calls.includes('renew'));
});

test('emits recovered once after a failure is followed by a successful pull', async () => {
  let pulls = 0;
  const client = fakeClient({
    async pullMessages() {
      pulls += 1;
      if (pulls === 1) throw new Error('boom');
      await new Promise((r) => setTimeout(r, 5));
      return [];
    },
  });
  const sub = new Subscriber(client, fast);
  sub.on('failure', () => {});
  const recovered = once(sub, 'recovered');
  sub.start();
  await recovered;
  await sub.stop();
});

test('stop is safe when never started', async () => {
  await new Subscriber(fakeClient(), fast).stop();
});
