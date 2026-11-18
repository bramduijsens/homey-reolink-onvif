'use strict';

const { EventEmitter } = require('node:events');

// One pull-point subscription at a time: devices have few slots and keep an orphaned one until its TTL runs out.
// Emits 'event' (parsed ONVIF event), 'subscribed' and 'failure' (Error).
class Subscriber extends EventEmitter {
  constructor(client, {
    ttlSeconds = 600,
    pullTimeoutSeconds = 10,
    messageLimit = 10,
    minBackoffMs = 2000,
    maxBackoffMs = 60000,
    maxPullFailures = 3,
  } = {}) {
    super();
    this._client = client;
    this._ttlSeconds = ttlSeconds;
    this._pullTimeoutSeconds = pullTimeoutSeconds;
    this._messageLimit = messageLimit;
    this._minBackoffMs = minBackoffMs;
    this._maxBackoffMs = maxBackoffMs;
    this._maxPullFailures = maxPullFailures;
    this._running = false;
    this._address = null;
    this._renewAt = 0;
    this._failures = 0;
    this._abort = null;
    this._wake = null;
    this._loop = null;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._abort = new AbortController();
    this._loop = this._run();
  }

  async stop() {
    if (!this._running) return;
    this._running = false;
    this._abort.abort();
    if (this._wake) this._wake();
    await this._loop;
    await this._release();
  }

  async _release() {
    const address = this._address;
    this._address = null;
    if (!address) return;
    try {
      await this._client.unsubscribe(address);
    } catch (err) {
      // Best effort: the device drops the subscription when the TTL expires.
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this._wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  async _run() {
    const { signal } = this._abort;
    let backoff = this._minBackoffMs;
    while (this._running) {
      try {
        if (!this._address) {
          this._address = await this._client.createPullPoint(this._ttlSeconds);
          this._renewAt = Date.now() + (this._ttlSeconds * 1000) / 2;
          this._failures = 0;
          this.emit('subscribed');
        }
        if (Date.now() >= this._renewAt) {
          await this._client.renew(this._address, this._ttlSeconds, { signal });
          this._renewAt = Date.now() + (this._ttlSeconds * 1000) / 2;
        }
        const events = await this._client.pullMessages(this._address, {
          timeoutSeconds: this._pullTimeoutSeconds,
          limit: this._messageLimit,
          signal,
        });
        for (const event of events) this.emit('event', event);
        backoff = this._minBackoffMs;
        this._failures = 0;
      } catch (err) {
        if (!this._running) break;
        this.emit('failure', err);
        if (this._address && ++this._failures >= this._maxPullFailures) await this._release();
        await this._sleep(backoff);
        backoff = Math.min(backoff * 2, this._maxBackoffMs);
      }
    }
  }
}

module.exports = { Subscriber };
