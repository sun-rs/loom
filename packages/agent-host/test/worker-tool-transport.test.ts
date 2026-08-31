import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createWorkerToolTransportEnvironment } from "../src/index.ts";

test("Worker tool transport creates a token-free per-launch rah wrapper", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-worker-tools-"));
  chmodSync(directory, 0o700);
  let revoked = 0;
  try {
    const lease = await createWorkerToolTransportEnvironment({
      credentialDirectory: directory,
      revokeCredential: () => {
        revoked += 1;
      },
      workerAccessToken: "worker-secret-value",
      workerApiOrigin: "http://127.0.0.1:43123",
    });
    const toolDirectory = lease.env.RAH_AGENT_TOOL_BIN;
    const tokenPath = lease.env.RAH_WORKER_SESSION_FILE;
    assert.ok(toolDirectory);
    assert.ok(tokenPath);
    assert.equal(toolDirectory, dirname(tokenPath));
    const wrapperPath = join(toolDirectory, "rah");
    assert.equal(lease.env.RAH_WORKER_CLI, wrapperPath);
    assert.equal(lstatSync(wrapperPath).mode & 0o777, 0o700);
    assert.equal(
      readFileSync(wrapperPath, "utf8").includes("worker-secret"),
      false,
    );
    assert.match(
      execFileSync(wrapperPath, ["worker", "help"], { encoding: "utf8" }),
      /rah worker sync/u,
    );

    await lease.release?.();
    assert.equal(revoked, 1);
    assert.equal(existsSync(toolDirectory), false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
