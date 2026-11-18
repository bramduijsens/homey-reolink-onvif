'use strict';

const Homey = require('homey');

class ReolinkOnvifApp extends Homey.App {
  async onInit() {
    this.log('Reolink ONVIF started');
  }
}

module.exports = ReolinkOnvifApp;
