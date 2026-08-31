import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { bootstrapStable } from "@rah-os/k-carrier";

import { NodeKCarrierSupervisedServiceLauncher } from "../src/index.ts";

test("supervised slot launcher passes private config and no parent environment", async () => {
  const fixture = await fixtureDirectory("rah-supervised-slot-");
  try {
    const launcher = new NodeKCarrierSupervisedServiceLauncher({
      argumentPrefix: [fixture.serviceFixturePath],
      configurationPath: fixture.serviceConfigurationPath,
      stateDir: fixture.kStateDir,
      stopTimeoutMs: 1_000,
    });
    const previous = process.env.RAH_SUPERVISOR_PARENT_SECRET;
    process.env.RAH_SUPERVISOR_PARENT_SECRET = "must-not-cross";
    try {
      const child = await launcher.launch("stable");
      const ready = (await waitForJson(fixture.readyPath)) as {
        configSecret: string;
        inheritedSecret: boolean;
        processId: number;
      };
      assert.equal(ready.processId, child.processId);
      assert.equal(ready.configSecret, "fd-only-service-secret");
      assert.equal(ready.inheritedSecret, false);
      await child.requestStop();
      assert.deepEqual(await child.exited, { code: 0, signal: null });
      assert.equal(alive(child.processId), false);
    } finally {
      if (previous === undefined) {
        delete process.env.RAH_SUPERVISOR_PARENT_SECRET;
      } else {
        process.env.RAH_SUPERVISOR_PARENT_SECRET = previous;
      }
    }
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("supervised service exits when its supervisor is SIGKILLed", async () => {
  const fixture = await fixtureDirectory("rah-supervisor-lease-");
  let serviceProcessId: number | undefined;
  try {
    const supervisorConfigurationPath = join(
      fixture.directory,
      "supervisor-fixture.json",
    );
    writeFileSync(
      supervisorConfigurationPath,
      JSON.stringify({
        kStateDir: fixture.kStateDir,
        readyPath: fixture.supervisorReadyPath,
        serviceConfigurationPath: fixture.serviceConfigurationPath,
        serviceFixturePath: fixture.serviceFixturePath,
      }),
      { mode: 0o600 },
    );
    const descriptor = openSync(supervisorConfigurationPath, "r");
    try {
      const supervisor = spawn(
        process.execPath,
        [
          join(
            import.meta.dirname,
            "fixtures",
            "k-supervised-service-launcher-child.mjs",
          ),
        ],
        {
          env: Object.create(null) as NodeJS.ProcessEnv,
          stdio: ["ignore", "ignore", "ignore", descriptor],
        },
      );
      const supervisorExited = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        supervisor.once("exit", (code, signal) => resolve({ code, signal }));
      });
      const observed = (await waitForJson(fixture.supervisorReadyPath)) as {
        processId: number;
      };
      serviceProcessId = observed.processId;
      assert.ok(serviceProcessId > 0);
      const supervisorExit = await supervisorExited;
      assert.equal(supervisorExit.signal, "SIGKILL");
      await waitUntil(() => !alive(serviceProcessId!), 2_000);
    } finally {
      closeSync(descriptor);
    }
  } finally {
    if (serviceProcessId !== undefined && alive(serviceProcessId)) {
      process.kill(serviceProcessId, "SIGKILL");
    }
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

async function fixtureDirectory(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  chmodSync(directory, 0o700);
  const kStateDir = join(directory, "k");
  await mkdir(kStateDir, { mode: 0o700 });
  const serviceFixturePath = join(
    import.meta.dirname,
    "fixtures",
    "k-supervised-service-child.mjs",
  );
  const sourceArtifactPath = join(directory, "source-service");
  writeFileSync(
    sourceArtifactPath,
    `#!/bin/sh\nexec "${process.execPath}" "${serviceFixturePath}" "$@"\n`,
    { mode: 0o500 },
  );
  await bootstrapStable({
    artifactPath: sourceArtifactPath,
    stateDir: kStateDir,
    version: "1.0.0",
  });
  const readyPath = join(directory, "service-ready.json");
  const supervisorReadyPath = join(directory, "supervisor-ready.json");
  const serviceConfigurationPath = join(directory, "service.json");
  writeFileSync(
    serviceConfigurationPath,
    JSON.stringify({
      configSecret: "fd-only-service-secret",
      readyPath,
    }),
    { mode: 0o600 },
  );
  return {
    directory,
    kStateDir,
    readyPath,
    serviceConfigurationPath,
    serviceFixturePath,
    supervisorReadyPath,
  };
}

async function waitForJson(path: string): Promise<unknown> {
  let value: unknown;
  await waitUntil(() => {
    try {
      value = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return true;
    } catch {
      return false;
    }
  }, 3_000);
  return value;
}

function alive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
