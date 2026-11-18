'use strict';

// Manual check against a real device: node scripts/live-check.js --host <ip> [--port 8000] [--user admin] [--minutes 2]
// The password comes from ONVIF_PASSWORD or a hidden prompt; it is never printed.

const readline = require('node:readline');
const { OnvifClient } = require('../lib/onvif');
const { KindTracker } = require('../lib/events');
const { Subscriber } = require('../lib/subscriber');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.includes(question)) rl.output.write(text);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const host = arg('host');
  if (!host) throw new Error('Usage: node scripts/live-check.js --host <ip> [--port 8000] [--user admin] [--minutes 2]');
  const port = Number(arg('port', 8000));
  const minutes = Number(arg('minutes', 2));
  const username = arg('user') || (await ask('Username: '));
  const password = process.env.ONVIF_PASSWORD || (await ask('Password (hidden): ', { hidden: true }));

  const client = new OnvifClient({ host, port, username, password });
  console.log(`clock offset: ${await client.syncTime()} ms`);
  const info = await client.getDeviceInformation();
  console.log(`device: ${info.manufacturer} ${info.model}, firmware ${info.firmwareVersion}`);

  const { body, contentType } = await client.fetchSnapshot();
  console.log(`snapshot: ${body.length} bytes, ${contentType}, JPEG magic: ${body[0] === 0xff && body[1] === 0xd8}`);

  const tracker = new KindTracker();
  const subscriber = new Subscriber(client);
  subscriber.on('subscribed', () => console.log(`subscribed; listening for ${minutes} min`));
  subscriber.on('failure', (err) => console.log(`failure: ${err.message}`));
  subscriber.on('event', (event) => {
    const change = tracker.update(event);
    console.log(`${new Date().toISOString()} ${event.topic} ${event.operation} state=${event.state}${change ? ` => ${change.kind}:${change.state}${change.initial ? ' (initial)' : ''}` : ''}`);
  });
  subscriber.start();
  await new Promise((resolve) => setTimeout(resolve, minutes * 60 * 1000));
  await subscriber.stop();
  console.log('done');
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
