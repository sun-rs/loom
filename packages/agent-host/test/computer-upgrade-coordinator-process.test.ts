import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ComputerUpgradeCoordinatorRequestStore,
  ComputerUpgradeCoordinatorRequestStoreFormatError,
  ComputerUpgradeCoordinatorRequestStoreSecurityError,
  NodeComputerUpgradeCoordinatorLauncher,
  type ComputerUpgradeCoordinatorRequest,
} from "../src/index.ts";

function request(
  currentArtifactPath: string,
): ComputerUpgradeCoordinatorRequest {
  return {
    carrier: "rah-k",
    controlAttachmentId: "primary",
    currentArtifactPath,
    managedAttachmentIdentities: {
      primary: "connection-primary",
      secondary: "connection-secondary",
    },
    mode: "upgrade",
    operationId: "upgrade-process-1",
    requestedAt: "2026-08-28T10:00:00.000Z",
    sourceBuildVersion: "1.0.0",
    sourceComputerInstanceId: "computer-incumbent-instance",
    targetBuildVersion: "2.0.0",
  };
}

test("coordinator request binds the operation to one managed control attachment", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-upgrade-control-owner-"));
  chmodSync(directory, 0o700);
  const artifactPath = join(directory, "computer");
  const requestPath = join(directory, "request.json");
  writeFileSync(artifactPath, "trusted", { mode: 0o700 });
  try {
    const store = new ComputerUpgradeCoordinatorRequestStore({ requestPath });
    const valid = request(artifactPath);
    await store.save(valid);
    assert.equal((await store.read())?.controlAttachmentId, "primary");
    await store.clear(valid.operationId);

    await assert.rejects(
      store.save({
        ...valid,
        controlAttachmentId: "unmanaged",
      }),
      ComputerUpgradeCoordinatorRequestStoreFormatError,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("coordinator request requires source and target releases to differ", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-upgrade-version-"));
  chmodSync(directory, 0o700);
  const artifactPath = join(directory, "computer");
  const requestPath = join(directory, "request.json");
  writeFileSync(artifactPath, "trusted", { mode: 0o700 });
  try {
    const store = new ComputerUpgradeCoordinatorRequestStore({ requestPath });
    await assert.rejects(
      store.save({
        ...request(artifactPath),
        targetBuildVersion: "1.0.0",
      }),
      ComputerUpgradeCoordinatorRequestStoreFormatError,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("coordinator request is strict, owner-private, atomic, and symlink-safe", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-upgrade-request-"));
  chmodSync(directory, 0o700);
  const artifactPath = join(directory, "computer");
  const requestPath = join(directory, "request.json");
  writeFileSync(artifactPath, "trusted", { mode: 0o700 });
  try {
    const store = new ComputerUpgradeCoordinatorRequestStore({ requestPath });
    assert.equal(await store.read(), null);
    await store.save(request(artifactPath));
    assert.deepEqual(
      JSON.parse(JSON.stringify(await store.read())),
      request(artifactPath),
    );

    await store.clear("upgrade-process-1");
    symlinkSync(join(directory, "outside"), requestPath);
    await assert.rejects(
      store.save(request(artifactPath)),
      ComputerUpgradeCoordinatorRequestStoreSecurityError,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("coordinator request is single-flight and exact replay is idempotent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-upgrade-single-flight-"));
  chmodSync(directory, 0o700);
  const artifactPath = join(directory, "computer");
  const requestPath = join(directory, "request.json");
  writeFileSync(artifactPath, "trusted", { mode: 0o700 });
  try {
    const store = new ComputerUpgradeCoordinatorRequestStore({ requestPath });
    const first = request(artifactPath);
    await store.save(first);
    await store.save(first);

    const conflicting = {
      ...first,
      operationId: "upgrade-process-2",
      targetBuildVersion: "3.0.0",
    } satisfies ComputerUpgradeCoordinatorRequest;
    await assert.rejects(
      store.save(conflicting),
      ComputerUpgradeCoordinatorRequestStoreFormatError,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(await store.read())), first);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("launcher starts a detached coordinator without inheriting parent secrets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-upgrade-launcher-"));
  chmodSync(directory, 0o700);
  const artifactPath = join(directory, "computer");
  const configurationPath = join(directory, "coordinator-config.json");
  const requestPath = join(directory, "request.json");
  const resultPath = `${requestPath}.observed`;
  writeFileSync(artifactPath, "trusted", { mode: 0o700 });
  writeFileSync(
    configurationPath,
    JSON.stringify({ fixtureSecret: "fd-only-coordinator-secret" }),
    { mode: 0o600 },
  );
  const store = new ComputerUpgradeCoordinatorRequestStore({ requestPath });
  await store.save(request(artifactPath));
  const previousSecret = process.env.RAH_UPGRADE_TEST_PARENT_SECRET;
  process.env.RAH_UPGRADE_TEST_PARENT_SECRET =
    "must-not-cross-process-boundary";
  try {
    const launcher = new NodeComputerUpgradeCoordinatorLauncher({
      argumentPrefix: [
        join(
          import.meta.dirname,
          "fixtures",
          "computer-upgrade-coordinator-child.mjs",
        ),
      ],
      executablePath: process.execPath,
    });
    const launched = await launcher.launch({
      configurationPath,
      requestPath,
    });
    assert.ok(launched.processId > 0);
    assert.equal(launched.requestPath, requestPath);

    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      try {
        const observed = JSON.parse(readFileSync(resultPath, "utf8")) as {
          configurationSecret: string;
          inheritedSecret: boolean;
          operationId: string;
          processId: number;
        };
        assert.equal(observed.operationId, "upgrade-process-1");
        assert.equal(
          observed.configurationSecret,
          "fd-only-coordinator-secret",
        );
        assert.equal(observed.inheritedSecret, false);
        assert.equal(observed.processId, launched.processId);
        const childProcessGroup = Number.parseInt(
          execFileSync(
            "/bin/ps",
            ["-o", "pgid=", "-p", String(launched.processId)],
            { encoding: "utf8" },
          ).trim(),
          10,
        );
        const parentProcessGroup = Number.parseInt(
          execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(process.pid)], {
            encoding: "utf8",
          }).trim(),
          10,
        );
        assert.equal(childProcessGroup, launched.processId);
        assert.notEqual(childProcessGroup, parentProcessGroup);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail("detached coordinator did not consume its durable request");
  } finally {
    if (previousSecret === undefined) {
      delete process.env.RAH_UPGRADE_TEST_PARENT_SECRET;
    } else {
      process.env.RAH_UPGRADE_TEST_PARENT_SECRET = previousSecret;
    }
    rmSync(directory, { force: true, recursive: true });
  }
});
