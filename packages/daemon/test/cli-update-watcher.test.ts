import assert from "node:assert/strict";
import {
  mkdirSync,
  realpathSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startCliUpdateWatcher } from "../src/cli-update-watcher.ts";
import { resolveLauncherPath } from "../src/local-runtime-inventory.ts";

/**
 * A user-installed CLI updates itself by repointing its stable launcher
 * (`~/.local/bin/claude` → `versions/2.1.283`, Homebrew `bin/codex` →
 * `Caskroom/codex/<version>`). Loom keeps pinning and verifying the exact file
 * it runs; the watcher only notices that the launcher now names another file
 * and asks the existing idle-only in-process restart to pick it up.
 */

test("the launcher path is the PATH entry itself, not its versioned target", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-launcher-"));
  try {
    const versions = join(root, "versions");
    const bin = join(root, "bin");
    mkdirSync(versions);
    mkdirSync(bin);
    const v1 = join(versions, "1.0.0");
    writeFileSync(v1, "#!/bin/sh\n", { mode: 0o755 });
    symlinkSync(v1, join(bin, "claude"));
    return resolveLauncherPath("claude", { PATH: bin }).then((launcher) => {
      assert.equal(launcher, join(bin, "claude"));
    });
  } finally {
    setTimeout(() => rmSync(root, { force: true, recursive: true }), 100);
  }
});

function identities() {
  return [
    {
      cliId: "claude",
      launcherPath: "/bin-dir/claude",
      resolvedPath: "/versions/1.0.0",
    },
    {
      cliId: "codex",
      launcherPath: "/bin-dir/codex",
      resolvedPath: "/cask/0.1/codex",
    },
  ];
}

test("an unchanged launcher requests no restart", async () => {
  let restarts = 0;
  const watcher = startCliUpdateWatcher({
    identities: identities(),
    intervalMs: 0,
    resolve: async (path) =>
      path.endsWith("claude") ? "/versions/1.0.0" : "/cask/0.1/codex",
    requestRestart: () => {
      restarts += 1;
      return "accepted";
    },
  });
  try {
    assert.equal(await watcher.tick(), "unchanged");
    assert.equal(restarts, 0);
  } finally {
    watcher.stop();
  }
});

test("a repointed launcher requests the idle restart, retries while busy and stops once accepted", async () => {
  const replies: Array<"busy" | "accepted"> = ["busy", "accepted"];
  const changes: string[] = [];
  let restarts = 0;
  const watcher = startCliUpdateWatcher({
    identities: identities(),
    intervalMs: 0,
    resolve: async (path) =>
      path.endsWith("claude") ? "/versions/1.0.1" : "/cask/0.1/codex",
    requestRestart: () => {
      restarts += 1;
      return replies.shift() ?? "accepted";
    },
    onChange: (cliId) => changes.push(cliId),
  });
  try {
    assert.equal(await watcher.tick(), "busy");
    assert.equal(await watcher.tick(), "accepted");
    assert.equal(await watcher.tick(), "stopped");
    assert.equal(restarts, 2);
    assert.deepEqual(changes, ["claude", "claude"]);
  } finally {
    watcher.stop();
  }
});

test("a launcher that briefly disappears mid-update is not a change", async () => {
  let restarts = 0;
  const watcher = startCliUpdateWatcher({
    identities: identities(),
    intervalMs: 0,
    resolve: async () => undefined,
    requestRestart: () => {
      restarts += 1;
      return "accepted";
    },
  });
  try {
    assert.equal(await watcher.tick(), "unchanged");
    assert.equal(restarts, 0);
  } finally {
    watcher.stop();
  }
});

test("the real resolver follows a repointed symlink", async () => {
  // macOS temp paths resolve through /private; compare real paths.
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "loom-launcher-repoint-")),
  );
  try {
    const v1 = join(root, "1.0.0");
    const v2 = join(root, "1.0.1");
    const launcher = join(root, "claude");
    writeFileSync(v1, "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(v2, "#!/bin/sh\n", { mode: 0o755 });
    symlinkSync(v1, launcher);
    let restarts = 0;
    const watcher = startCliUpdateWatcher({
      identities: [
        { cliId: "claude", launcherPath: launcher, resolvedPath: v1 },
      ],
      intervalMs: 0,
      requestRestart: () => {
        restarts += 1;
        return "accepted";
      },
    });
    try {
      assert.equal(await watcher.tick(), "unchanged");
      unlinkSync(launcher);
      symlinkSync(v2, launcher);
      assert.equal(await watcher.tick(), "accepted");
      assert.equal(restarts, 1);
    } finally {
      watcher.stop();
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
