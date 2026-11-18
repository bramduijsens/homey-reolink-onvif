# Reolink ONVIF for Homey

Adds Reolink video doorbells to Homey Pro over ONVIF. The app talks to the doorbell on your local network only; no cloud account and no Reolink HTTP API are needed.

> Status: work in progress. The ONVIF client has been verified against a real doorbell, but the Homey app itself has not been run on a Homey yet (see [What has been tested](#what-has-been-tested)).

## Supported devices

| Device | Firmware | Status |
| --- | --- | --- |
| Reolink Video Doorbell WiFi (D340B) | v3.0.0.7386_26110302 | ONVIF client verified |

Other Reolink doorbells or ONVIF devices that expose the same event topics may work, but are untested.

## Capabilities

The driver `Reolink Doorbell` uses the Homey device class `doorbell` and connectivity `lan`.

| Capability | Source ONVIF topic(s) |
| --- | --- |
| `alarm_motion` | `RuleEngine/CellMotionDetector/Motion`, `VideoSource/MotionAlarm` |
| `alarm_generic.person` | `RuleEngine/MyRuleDetector/PeopleDetect` |
| `alarm_generic.vehicle` | `RuleEngine/MyRuleDetector/VehicleDetect`, `RuleEngine/MyRuleDetector/Non_Motor_VehicleDetect` |
| `alarm_generic.pet` | `RuleEngine/MyRuleDetector/DogCatDetect` |
| `alarm_generic.face` | `RuleEngine/MyRuleDetector/FaceDetect` |
| `alarm_generic.package` | `RuleEngine/MyRuleDetector/Package` |
| `alarm_generic.doorbell` | `RuleEngine/MyRuleDetector/Visitor` |

When several topics map to the same capability, the capability is active while any of them is active.

Other features:

- **Flow trigger "Doorbell pressed"**, fired only on a real press (not on the initial state read when the app connects).
- **Camera snapshot** shown on the device tile, fetched from the doorbell over HTTP digest authentication and refreshed (at most every 2 seconds) when an event becomes active.
- **Device settings**: host, ONVIF port, username and password can be changed after pairing; model and firmware are shown read-only.
- **Pairing**: finds doorbells with WS-Discovery or lets you enter the IP address manually, and checks the credentials before the device is added.

### Not supported

- Doorbell settings such as chime volume, LED or quick replies. On the tested doorbell the Reolink HTTP API (ports 80/443) and the Baichuan port (9000) are closed, so only ONVIF is available.
- Two-way audio and live video. The RTSP streams exist, but the main stream uses a multilayer H.265 variant that not every decoder handles, so it is not exposed.
- PTZ and device I/O (the doorbell does not offer them).

## Requirements

- Homey Pro (platform `local`), Homey firmware 12.0.0 or later.
- ONVIF enabled on the doorbell and a local user account on it.
- The doorbell and Homey on the same network (WS-Discovery uses UDP multicast on port 3702).

## How this app came about

The app was built step by step, with the doorbell as the reference device and AI assistance (GitHub Copilot) for research, code and tests.

1. **Probing the doorbell.** Small throw-away Python scripts checked which ports and APIs the doorbell exposes. Result: only ONVIF (port 8000) and RTSP (port 554) are reachable. ONVIF offers WS-Security digest authentication (with the need to align the clock with the device), pull-point event subscriptions, an imaging service and a snapshot endpoint.
2. **Observing events.** A pull-point subscription was recorded while walking in front of the camera and pressing the bell. This showed which topics exist, that the bell is a state topic that stays active for about 5 seconds, and that subscription slots are limited: re-subscribing in a loop makes the doorbell answer with a SOAP fault until the old subscription expires.
3. **Own ONVIF client.** Instead of a large ONVIF dependency, a small client was written in Node.js (`lib/`), with `fast-xml-parser` as the only dependency:
   - `soap.js`: SOAP 1.2 with WS-Security `UsernameToken` digest and fault handling.
   - `digest-http.js`: HTTP digest authentication for snapshots (5 MB limit, matching Homey's image limit).
   - `onvif.js`: device information, clock offset, snapshot URI and the pull-point calls.
   - `events.js`: turns notifications into events and folds topics into one state per capability.
   - `subscriber.js`: keeps exactly one subscription alive (renew, back-off, unsubscribe on stop).
   - `discovery.js`: WS-Discovery probe.
4. **Homey app.** A driver, device class, pairing view, settings and flow trigger on top of that library.

## What has been tested

**Unit tests** (`npm test`, Node.js test runner, 30 tests): SOAP envelopes and faults, WS-Security digest, HTTP digest (including the RFC 2617 example), timeouts and size limits, event parsing, state tracking, subscriber lifecycle (renew, back-off, re-subscribe, recovery, clean stop), WS-Discovery parsing and the ONVIF client against a fake device. All fixtures are synthetic; no real addresses or credentials are used.

**Live check on a real doorbell** (`node scripts/live-check.js --host <ip>`), a Reolink D340B on firmware v3.0.0.7386_26110302:

- clock offset detected and authenticated calls accepted,
- device information read,
- snapshot downloaded (valid JPEG, about 200 KB),
- pull-point subscription received the initial state of all topics and the changes for person, motion and doorbell press with the expected states.

**Static validation:** `homey app validate --level publish` passes.

**Not yet tested:**

- running the app on a Homey (`homey app run`), including pairing, discovery from the Homey, and the camera image tile,
- whether Homey creates Flow cards for the `alarm_generic.*` sub-capabilities (the documentation says sub-capabilities do not get automatic cards; custom triggers will be added if needed),
- vehicle, pet, face and package detection (only motion, person and doorbell have been triggered on the real device),
- long-running behaviour (subscription renewal over many hours, network loss, doorbell reboot),
- other doorbell models and firmware versions.

## Development

```powershell
npm install
npm test
node scripts\live-check.js --host <doorbell-ip> --minutes 2   # asks for username and password (hidden)
homey app validate --level publish
homey app run
```

`app.json` in the repository root is generated from `.homeycompose/`; edit the compose files instead. The images in `assets/` and `drivers/doorbell/assets/images/` are placeholders.

## Privacy and security

- The app only communicates with the doorbell you add, over your local network.
- Credentials are stored in the Homey device settings and are used for ONVIF authentication only. No credentials, addresses or recordings are included in this repository.
- ONVIF on the doorbell uses plain HTTP, so use a trusted network.

## License

MIT, see [LICENSE](LICENSE).

## Disclaimer

This is an independent community project. It is not affiliated with, endorsed by or supported by Reolink or Athom.
