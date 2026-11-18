'use strict';

const Homey = require('homey');
const { OnvifClient } = require('../../lib/onvif');
const { discover } = require('../../lib/discovery');

const HOST_PATTERN = /^[A-Za-z0-9.-]+$/;

class DoorbellDriver extends Homey.Driver {
  async onPair(session) {
    session.setHandler('discover', async () => {
      try {
        return await discover();
      } catch (err) {
        this.error('Discovery failed:', err.message);
        return [];
      }
    });

    session.setHandler('connect', async ({ host, port, username, password }) => {
      const hostName = String(host || '').trim();
      const portNumber = Number(port);
      if (!HOST_PATTERN.test(hostName)) throw new Error(this.homey.__('pair.invalid_host'));
      if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
        throw new Error(this.homey.__('pair.invalid_port'));
      }

      const client = new OnvifClient({ host: hostName, port: portNumber, username, password });
      const info = await client.getDeviceInformation();
      return {
        name: info.model,
        data: { id: info.serialNumber },
        settings: {
          host: hostName,
          port: portNumber,
          username,
          password,
          model: info.model,
          firmware: info.firmwareVersion,
        },
      };
    });
  }
}

module.exports = DoorbellDriver;
