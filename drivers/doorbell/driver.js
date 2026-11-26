'use strict';

const Homey = require('homey');
const { OnvifClient } = require('../../lib/onvif');
const { discover } = require('../../lib/discovery');

const HOST_PATTERN = /^[A-Za-z0-9.-]+$/;

const CONDITIONS = {
  is_person_detected: 'alarm_person',
  is_vehicle_detected: 'alarm_vehicle',
  is_pet_detected: 'alarm_pet',
  is_face_detected: 'alarm_face',
  is_package_detected: 'alarm_package',
  is_doorbell_pressed: 'alarm_doorbell',
};

class DoorbellDriver extends Homey.Driver {
  async onInit() {
    for (const [id, capability] of Object.entries(CONDITIONS)) {
      this.homey.flow
        .getConditionCard(id)
        .registerRunListener(async ({ device }) => device.getCapabilityValue(capability) === true);
    }
    this.homey.flow
      .getActionCard('update_snapshot')
      .registerRunListener(async ({ device }) => device.updateSnapshot());
    this.homey.flow
      .getActionCard('take_snapshot')
      .registerRunListener(async ({ device }) => ({ snapshot: await device.takeSnapshot() }));
  }

  async onPair(session) {
    let device = null;

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
      device = {
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

    session.setHandler('list_devices', async () => {
      this.log('Listing devices for pairing:', device ? device.name : 'none');
      return device ? [device] : [];
    });
  }
}

module.exports = DoorbellDriver;
