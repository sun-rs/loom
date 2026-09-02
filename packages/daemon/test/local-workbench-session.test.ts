import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadOrCreateLocalWorkbenchSessionToken } from "../src/local-workbench-session.ts";

test("the loopback browser session token is owner-private and stable across process starts", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-loopback-session-"));
  try {
    chmodSync(directory, 0o700);
    const first = loadOrCreateLocalWorkbenchSessionToken({ directory });
    const second = loadOrCreateLocalWorkbenchSessionToken({ directory });
    assert.equal(second, first);
    assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(
      statSync(join(directory, "loopback-session.token")).mode & 0o777,
      0o600,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
