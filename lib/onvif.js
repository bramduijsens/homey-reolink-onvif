'use strict';

const { call, textOf, toArray } = require('./soap');
const { digestGet } = require('./digest-http');
const { parsePullMessages } = require('./events');

const NS_DEVICE = 'xmlns:tds="http://www.onvif.org/ver10/device/wsdl"';
const NS_MEDIA = 'xmlns:trt="http://www.onvif.org/ver10/media/wsdl"';
const NS_EVENTS = 'xmlns:tev="http://www.onvif.org/ver10/events/wsdl"';
const NS_WSNT = 'xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"';

const ACTION_CREATE_PULLPOINT = 'http://www.onvif.org/ver10/events/wsdl/EventPortType/CreatePullPointSubscriptionRequest';
const ACTION_PULL = 'http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/PullMessagesRequest';
const ACTION_RENEW = 'http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/RenewRequest';
const ACTION_UNSUBSCRIBE = 'http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest';

const FALLBACK_SNAPSHOT_PATH = '/onvif/snapshot?channel=0';

class OnvifClient {
  constructor({ host, port = 80, username, password, timeoutMs = 8000 }) {
    this.host = host;
    this.port = port;
    this.username = username;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.offsetMs = 0;
    this._services = null;
  }

  get deviceUrl() {
    return `http://${this.host}:${this.port}/onvif/device_service`;
  }

  _security() {
    return { username: this.username, password: this.password, offsetMs: this.offsetMs };
  }

  _call(url, body, { authenticated = true, action, signal, timeoutMs } = {}) {
    return call(url, body, {
      security: authenticated ? this._security() : undefined,
      action,
      to: action ? url : undefined,
      timeoutMs: timeoutMs || this.timeoutMs,
      signal,
    });
  }

  // Cameras reject WS-Security tokens whose timestamp is off; align with the device clock first.
  async syncTime() {
    const body = await this._call(this.deviceUrl, `<tds:GetSystemDateAndTime ${NS_DEVICE}/>`, { authenticated: false });
    const utc = body.GetSystemDateAndTimeResponse.SystemDateAndTime.UTCDateTime;
    const { Hour, Minute, Second } = utc.Time;
    const { Year, Month, Day } = utc.Date;
    this.offsetMs = Date.UTC(+Year, +Month - 1, +Day, +Hour, +Minute, +Second) - Date.now();
    return this.offsetMs;
  }

  async getDeviceInformation() {
    const body = await this._call(this.deviceUrl, `<tds:GetDeviceInformation ${NS_DEVICE}/>`);
    const info = body.GetDeviceInformationResponse;
    return {
      manufacturer: info.Manufacturer,
      model: info.Model,
      firmwareVersion: info.FirmwareVersion,
      serialNumber: info.SerialNumber,
    };
  }

  async getServices() {
    if (this._services) return this._services;
    const body = await this._call(
      this.deviceUrl,
      `<tds:GetCapabilities ${NS_DEVICE}><tds:Category>All</tds:Category></tds:GetCapabilities>`,
    );
    const caps = body.GetCapabilitiesResponse.Capabilities;
    this._services = {
      events: caps.Events && caps.Events.XAddr,
      media: caps.Media && caps.Media.XAddr,
    };
    return this._services;
  }

  async getSnapshotUri() {
    const { media } = await this.getServices();
    if (!media) throw new Error('Device has no media service');
    const profiles = await this._call(media, `<trt:GetProfiles ${NS_MEDIA}/>`);
    const token = toArray(profiles.GetProfilesResponse.Profiles)[0]['@_token'];
    const body = await this._call(
      media,
      `<trt:GetSnapshotUri ${NS_MEDIA}><trt:ProfileToken>${token}</trt:ProfileToken></trt:GetSnapshotUri>`,
    );
    return body.GetSnapshotUriResponse.MediaUri.Uri;
  }

  async fetchSnapshot({ signal } = {}) {
    let uri;
    try {
      uri = await this.getSnapshotUri();
    } catch (err) {
      uri = `http://${this.host}:${this.port}${FALLBACK_SNAPSHOT_PATH}`;
    }
    return digestGet(uri, { username: this.username, password: this.password, timeoutMs: this.timeoutMs, signal });
  }

  async createPullPoint(ttlSeconds) {
    const { events } = await this.getServices();
    if (!events) throw new Error('Device has no events service');
    const body = await this._call(
      events,
      `<tev:CreatePullPointSubscription ${NS_EVENTS}><tev:InitialTerminationTime>PT${ttlSeconds}S</tev:InitialTerminationTime></tev:CreatePullPointSubscription>`,
      { action: ACTION_CREATE_PULLPOINT },
    );
    return textOf(body.CreatePullPointSubscriptionResponse.SubscriptionReference.Address);
  }

  async pullMessages(address, { timeoutSeconds = 10, limit = 10, signal } = {}) {
    const body = await this._call(
      address,
      `<tev:PullMessages ${NS_EVENTS}><tev:Timeout>PT${timeoutSeconds}S</tev:Timeout><tev:MessageLimit>${limit}</tev:MessageLimit></tev:PullMessages>`,
      { action: ACTION_PULL, signal, timeoutMs: timeoutSeconds * 1000 + this.timeoutMs },
    );
    return parsePullMessages(body);
  }

  async renew(address, ttlSeconds, { signal } = {}) {
    await this._call(
      address,
      `<wsnt:Renew ${NS_WSNT}><wsnt:TerminationTime>PT${ttlSeconds}S</wsnt:TerminationTime></wsnt:Renew>`,
      { action: ACTION_RENEW, signal },
    );
  }

  async unsubscribe(address) {
    await this._call(address, `<wsnt:Unsubscribe ${NS_WSNT}/>`, { action: ACTION_UNSUBSCRIBE });
  }
}

module.exports = { OnvifClient };
