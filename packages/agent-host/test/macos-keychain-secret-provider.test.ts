import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  MacOSKeychainSecretProvider,
  SystemComputerSecretProvider,
} from "../src/index.ts";

function childProcess(
  start: (child: EventEmitter & Record<string, unknown>) => void,
): EventEmitter & Record<string, unknown> {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  queueMicrotask(() => start(child));
  return child;
}

test("macOS Keychain provider uses one fixed shell-free security lookup and returns no diagnostics", async () => {
  const calls: Array<{
    arguments_: readonly string[];
    executablePath: string;
    options: Record<string, unknown>;
  }> = [];
  const provider = new MacOSKeychainSecretProvider({
    platform: "darwin",
    spawn: (executablePath, arguments_, options) => {
      calls.push({
        arguments_,
        executablePath,
        options: options as Record<string, unknown>,
      });
      return childProcess((child) => {
        child.emit("exit", 0, null);
        (child.stderr as PassThrough).end("diagnostic must be ignored\n");
        (child.stdout as PassThrough).end("provider-secret\n");
        child.emit("close", 0, null);
      }) as never;
    },
  });

  assert.equal(
    await provider.load({
      account: "alice",
      service: "dev.rah-os.provider.codex",
      source: "macos-keychain",
    }),
    "provider-secret",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.executablePath, "/usr/bin/security");
  assert.deepEqual(calls[0]?.arguments_, [
    "find-generic-password",
    "-w",
    "-s",
    "dev.rah-os.provider.codex",
    "-a",
    "alice",
  ]);
  assert.equal(calls[0]?.options.shell, false);
  assert.deepEqual(calls[0]?.options.env, {});
  assert.deepEqual(calls[0]?.options.stdio, ["ignore", "pipe", "pipe"]);
});

test("macOS Keychain provider bounds output, timeout, platform, and exit failures", async () => {
  const oversized = new MacOSKeychainSecretProvider({
    platform: "darwin",
    spawn: () =>
      childProcess((child) => {
        (child.stdout as PassThrough).end("x".repeat(65_537));
        child.emit("close", 0, null);
      }) as never,
  });
  await assert.rejects(
    oversized.load({
      account: "alice",
      service: "dev.rah-os.provider.codex",
      source: "macos-keychain",
    }),
    /safe byte limit/u,
  );

  let killed = false;
  const timedOut = new MacOSKeychainSecretProvider({
    platform: "darwin",
    spawn: () => {
      const child = childProcess(() => undefined);
      child.kill = () => {
        killed = true;
        return true;
      };
      return child as never;
    },
    timeoutMs: 5,
  });
  await assert.rejects(
    timedOut.load({
      account: "alice",
      service: "dev.rah-os.provider.codex",
      source: "macos-keychain",
    }),
    /timed out/u,
  );
  assert.equal(killed, true);

  const unsupported = new MacOSKeychainSecretProvider({ platform: "linux" });
  await assert.rejects(
    unsupported.load({
      account: "alice",
      service: "dev.rah-os.provider.codex",
      source: "macos-keychain",
    }),
    /requires macOS/u,
  );
});

test("system Computer secret provider routes file and Keychain references without fallback", async () => {
  const calls: string[] = [];
  const provider = new SystemComputerSecretProvider({
    file: {
      load: async () => {
        calls.push("file");
        return "file-secret";
      },
    },
    keychain: {
      load: async () => {
        calls.push("keychain");
        return "keychain-secret";
      },
    },
  });
  assert.equal(
    await provider.load({ path: "/private/secret", source: "file" }),
    "file-secret",
  );
  assert.equal(
    await provider.load({
      account: "alice",
      service: "dev.rah-os.provider.codex",
      source: "macos-keychain",
    }),
    "keychain-secret",
  );
  assert.deepEqual(calls, ["file", "keychain"]);
});
