import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { parseMacOSLocalCoreInstallArguments } from "../src/macos-local-core-install-command.ts";

test("macOS local Core install command parses explicit LAN product inputs", () => {
  assert.deepEqual(
    parseMacOSLocalCoreInstallArguments([
      "--mode",
      "lan",
      "--workspace",
      "/Users/test/workspace",
      "--origin",
      "https://192.168.1.86:4174",
      "--bind-host",
      "0.0.0.0",
      "--home",
      "/Users/test/Library/Application Support/RAH OS",
      "--certificate-path",
      "/Users/test/tls.crt",
      "--private-key-path",
      "/Users/test/tls.key",
      "--ca-certificate-path",
      "/Users/test/ca.crt",
      "--activate",
      "--replace-loaded",
      "--replace-staged",
    ]),
    {
      activate: true,
      bindHost: "0.0.0.0",
      caCertificatePath: "/Users/test/ca.crt",
      certificatePath: "/Users/test/tls.crt",
      home: "/Users/test/Library/Application Support/RAH OS",
      mode: "lan",
      origin: "https://192.168.1.86:4174",
      privateKeyPath: "/Users/test/tls.key",
      replaceLoaded: true,
      replaceStaged: true,
      workspace: "/Users/test/workspace",
    },
  );
});

test("macOS local Core install command keeps loopback and replacement intent strict", () => {
  assert.deepEqual(
    parseMacOSLocalCoreInstallArguments([
      "--mode",
      "loopback",
      "--workspace",
      "/Users/test/workspace",
      "--web-port",
      "4180",
    ]),
    {
      activate: false,
      mode: "loopback",
      replaceLoaded: false,
      replaceStaged: false,
      webPort: 4180,
      workspace: "/Users/test/workspace",
    },
  );
  assert.throws(
    () =>
      parseMacOSLocalCoreInstallArguments([
        "--mode",
        "lan",
        "--workspace",
        "/Users/test/workspace",
      ]),
    /--origin is required/u,
  );
  assert.throws(
    () =>
      parseMacOSLocalCoreInstallArguments([
        "--mode",
        "loopback",
        "--workspace",
        "/Users/test/workspace",
        "--replace-loaded",
      ]),
    /requires --activate/u,
  );
  assert.throws(
    () =>
      parseMacOSLocalCoreInstallArguments([
        "--mode",
        "loopback",
        "--workspace",
        join("relative", "workspace"),
      ]),
    /--workspace must be absolute/u,
  );
});

test("macOS local Core quick start is one explicit first-run authority", () => {
  assert.deepEqual(parseMacOSLocalCoreInstallArguments(["--quick-start"]), {
    activate: true,
    mode: "loopback",
    quickStart: true,
    replaceLoaded: false,
    replaceStaged: false,
    webPort: 4173,
  });
  assert.throws(
    () =>
      parseMacOSLocalCoreInstallArguments([
        "--quick-start",
        "--workspace",
        "/Users/test/workspace",
      ]),
    /--quick-start must be used alone/u,
  );
  assert.throws(
    () => parseMacOSLocalCoreInstallArguments(["--quick-start", "--activate"]),
    /--quick-start must be used alone/u,
  );
});

test("macOS local Core install accepts an immutable product directory", () => {
  assert.deepEqual(
    parseMacOSLocalCoreInstallArguments([
      "--mode",
      "loopback",
      "--workspace",
      "/Users/test/workspace",
      "--product-directory",
      "/Applications/RAH OS Core",
    ]),
    {
      activate: false,
      mode: "loopback",
      productDirectory: "/Applications/RAH OS Core",
      replaceLoaded: false,
      replaceStaged: false,
      webPort: 4173,
      workspace: "/Users/test/workspace",
    },
  );
});

test("macOS local Core uninstall is explicit and has no data-deletion surface", () => {
  assert.deepEqual(parseMacOSLocalCoreInstallArguments(["--uninstall"]), {
    uninstall: true,
  });
  assert.throws(
    () => parseMacOSLocalCoreInstallArguments(["--purge-data"]),
    /unknown local Core install option/u,
  );
  assert.throws(
    () =>
      parseMacOSLocalCoreInstallArguments([
        "--uninstall",
        "--mode",
        "loopback",
      ]),
    /cannot be combined/u,
  );
});
