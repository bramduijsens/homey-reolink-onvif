'use strict';

const Homey = require('homey');
const { OnvifClient } = require('../../lib/onvif');
const { KindTracker } = require('../../lib/events');
const { Subscriber } = require('../../lib/subscriber');

const KIND_CAPABILITIES = {
  motion: 'alarm_motion',
  person: 'alarm_person',
  vehicle: 'alarm_vehicle',
  pet: 'alarm_pet',
  face: 'alarm_face',
  package: 'alarm_package',
  doorbell: 'alarm_doorbell',
};

const IMAGE_REFRESH_MS = 2000;

class DoorbellDevice extends Homey.Device {
  async onInit() {
    this._client = null;
    this._subscriber = null;
    this._unavailable = false;
    this._lastImageUpdate = 0;
    this._doorbellPressed = this.homey.flow.getDeviceTriggerCard('doorbell_pressed');

    this._image = await this.homey.images.createImage();
    this._image.setStream(async (stream) => {
      if (!this._client) throw new Error('Not connected');
      const { body } = await this._client.fetchSnapshot();
      stream.end(body);
    });
    await this.setCameraImage('snapshot', this.homey.__('camera.snapshot'), this._image);

    this._connect(this.getSettings());
  }

  _connect(settings) {
    const tracker = new KindTracker();
    this._client = new OnvifClient({
      host: settings.host,
      port: Number(settings.port),
      username: settings.username,
      password: settings.password,
    });
    const subscriber = new Subscriber(this._client);
    subscriber.on('event', (event) => this._onEvent(tracker, event));
    subscriber.on('failure', (err) => {
      this.error('ONVIF failure:', err.message);
      if (this._unavailable) return;
      this._unavailable = true;
      this.setUnavailable(err.message).catch(this.error);
    });
    subscriber.on('recovered', () => {
      this._unavailable = false;
      this.setAvailable().catch(this.error);
    });
    subscriber.start();
    this._subscriber = subscriber;
  }

  async _disconnect() {
    const subscriber = this._subscriber;
    this._subscriber = null;
    if (subscriber) await subscriber.stop();
  }

  _onEvent(tracker, event) {
    const change = tracker.update(event);
    if (!change) return;
    this.setCapabilityValue(KIND_CAPABILITIES[change.kind], change.state).catch(this.error);
    if (!change.state || change.initial) return;
    if (change.kind === 'doorbell') this._doorbellPressed.trigger(this).catch(this.error);
    this._refreshImage();
  }

  _refreshImage() {
    const now = Date.now();
    if (now - this._lastImageUpdate < IMAGE_REFRESH_MS) return;
    this._lastImageUpdate = now;
    this._image.update().catch(this.error);
  }

  async updateSnapshot() {
    if (!this._client) throw new Error('Not connected');
    await this._image.update();
  }

  async takeSnapshot() {
    if (!this._client) throw new Error('Not connected');
    const { body } = await this._client.fetchSnapshot();
    const image = await this.homey.images.createImage();
    image.setStream(async (stream) => {
      stream.end(body);
    });
    return image;
  }

  async onSettings({ newSettings }) {
    await this._disconnect();
    this._connect(newSettings);
  }

  async onUninit() {
    await this._disconnect();
  }
}

module.exports = DoorbellDevice;
