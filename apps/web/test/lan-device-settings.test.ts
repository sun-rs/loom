import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const componentDirectory = join(import.meta.dirname, "..", "src", "components");

test("LAN device administration is an edge-owned settings component", () => {
  const settings = readFileSync(
    join(componentDirectory, "settings-surface.tsx"),
    "utf8",
  );
  const devices = readFileSync(
    join(componentDirectory, "lan-device-settings.tsx"),
    "utf8",
  );
  const app = readFileSync(join(componentDirectory, "..", "App.tsx"), "utf8");

  assert.match(app, /from "\.\/components\/settings-surface\.tsx"/u);
  assert.doesNotMatch(app, /LanAccessClient|LanDeviceSettings/u);
  assert.doesNotMatch(settings, /LanDeviceSettingsContent/u);
  assert.doesNotMatch(settings, /局域网设备/u);
  assert.match(devices, /client\s*\.session\(/u);
  assert.match(devices, /client\.listDevices\(/u);
  assert.match(devices, /client\s*\.issuePairingCode\(/u);
  assert.match(devices, /client\.revokeDevice\(/u);
  assert.match(devices, /useDialogProtocol/u);
  assert.match(devices, /location\.assign\("\/_rah\/pair"\)/u);
  assert.doesNotMatch(devices, /RahClient|\/v3\/client|authorization/iu);
});
