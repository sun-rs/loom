import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { isAbsolute, join } from "node:path";

// Startup evidence, not a second service configuration. The current launch-mode
// owner still interprets network options; restart preserves the incumbent mode.
const networkKeys = [
  "RAH_TAILNET_HOST",
  "RAH_LAN_ORIGIN",
  "RAH_LAN_BIND_HOST",
  "RAH_LAN_CERT_PATH",
  "RAH_LAN_KEY_PATH",
  "RAH_WEB_PORT",
];
function networkEnvironment(mode) {
  assert.ok(
    mode && ["loopback", "tailnet", "lan"].includes(mode.kind),
    "Invalid workbench launch mode",
  );
  if (mode.kind === "lan") {
    const origin = new URL(mode.publicOrigin);
    assert.equal(origin.protocol, "https:");
    assert.equal(origin.origin, mode.publicOrigin);
    assert.ok(typeof mode.bindHost === "string" && mode.bindHost.length > 0);
    const env = {
      RAH_LAN_ORIGIN: mode.publicOrigin,
      RAH_LAN_BIND_HOST: mode.bindHost,
    };
    for (const [key, path] of [
      ["RAH_LAN_CERT_PATH", mode.certificatePath],
      ["RAH_LAN_KEY_PATH", mode.privateKeyPath],
    ]) {
      if (path !== undefined) {
        assert.ok(isAbsolute(path));
        env[key] = path;
      }
    }
    return env;
  }
  assert.ok(
    Number.isInteger(mode.port) && mode.port > 0 && mode.port <= 65535,
    "Invalid launch port",
  );
  if (mode.kind === "tailnet")
    assert.ok(isIP(mode.bindHost), "Invalid Tailnet bind address");
  return {
    RAH_WEB_PORT: String(mode.port),
    ...(mode.kind === "tailnet" ? { RAH_TAILNET_HOST: mode.bindHost } : {}),
  };
}
export function restartNetworkEnvironment(environment, receipt, incumbentPid) {
  assert.ok(
    receipt?.schemaVersion === 1,
    "Missing or unsupported workbench launch receipt; legacy instances require explicit network adoption",
  );
  assert.equal(
    receipt.pid,
    incumbentPid,
    "Launch receipt does not belong to incumbent",
  );
  const next = { ...environment };
  for (const key of networkKeys) delete next[key];
  return { ...next, ...networkEnvironment(receipt.mode) };
}
export async function readLaunchReceipt(state) {
  try {
    return JSON.parse(
      await readFile(join(state, "workbench-launch.json"), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
export async function writeLaunchReceipt(state, mode, pid = process.pid) {
  networkEnvironment(mode);
  assert.ok(Number.isInteger(pid) && pid > 0);
  const temporary = join(state, `.workbench-launch-${randomUUID()}.json`);
  try {
    await writeFile(
      temporary,
      JSON.stringify({ schemaVersion: 1, pid, mode }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await rename(temporary, join(state, "workbench-launch.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}
