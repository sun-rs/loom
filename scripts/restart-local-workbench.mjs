import {
  readLaunchReceipt,
  restartNetworkEnvironment,
} from "./workbench-launch-receipt.mjs";
import { workbenchLaunchMode } from "./workbench-launch-mode.mjs";
import { openServiceLogs } from "@rah-os/agent-host";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { snapshotWorkbenchAssets } from "./workbench-web-assets.mjs";
import {
  assertWorkbenchRestartable,
  backupState,
  fileInventory,
  guardedStop,
  preflightKernelUpgrade,
  verifyStateBackup,
} from "./workbench-restart-guard.mjs";
import { assertRahOsRepositoryIdentity } from "./repository-identity.mjs";

// Explicit one-shot local operator command. Never called by a browser or cron.
const { values } = parseArgs({
  options: {
    pid: { type: "string" },
    state: { type: "string" },
    port: { type: "string", default: "4173" },
    build: { type: "string" },
    "adopt-network-from-environment": { type: "boolean", default: false },
  },
});
const repo = await realpath(join(import.meta.dirname, ".."));
await assertRahOsRepositoryIdentity({
  commandCwd: process.cwd(),
  repositoryDirectory: repo,
});
assert.ok(
  values.state && values.build && values.pid,
  "Required: --pid --state --build (exact Web build ID)",
);
const state = await realpath(resolve(values.state));
assert.equal(
  basename(state),
  "state",
  "Expected the local workbench's canonical state child",
);
assert.notEqual(state, dirname(state));
assert.notEqual(state, repo);
const pid = Number(values.pid),
  port = Number(values.port);
assert.ok(Number.isInteger(pid) && pid > 1 && pid !== process.pid);
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
const run = (bin, args) =>
  execFileSync(bin, args, {
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, LC_ALL: "C" },
  }).trim();
const identity = () =>
  run("/bin/ps", ["-p", String(pid), "-o", "lstart=,command="]);
const initial = identity();
assert.match(
  initial,
  /(?:^|\s|\/)node\s+(?:scripts\/run-local-workbench\.mjs|\S+\/scripts\/run-local-workbench\.mjs)$/,
);
function inspect() {
  assert.equal(identity(), initial, "Incumbent identity changed");
  assert.ok(
    run("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"])
      .split("\n")
      .includes(`n${repo}`),
    "PID belongs to another checkout",
  );
  const files = run("/usr/sbin/lsof", ["-p", String(pid), "-Fn"]);
  assert.ok(
    files.split("\n").includes(`n${join(state, "room.db")}`),
    "PID does not own this state database",
  );
  const listening = run("/usr/sbin/lsof", [
    "-a",
    "-p",
    String(pid),
    "-iTCP:" + port,
    "-sTCP:LISTEN",
    "-t",
  ]);
  assert.equal(listening, String(pid), "PID does not own this port");
  const db = new DatabaseSync(join(state, "room.db"), { readOnly: true });
  try {
    assertWorkbenchRestartable(db);
    return db
      .prepare(
        "SELECT room_id, max(room_seq) AS seq FROM room_events GROUP BY room_id ORDER BY room_id",
      )
      .all();
  } finally {
    db.close();
  }
}
const launchReceipt = values["adopt-network-from-environment"]
  ? {
      schemaVersion: 1,
      pid,
      mode: workbenchLaunchMode(process.env, dirname(state)),
    }
  : await readLaunchReceipt(state);
const successorEnvironment = restartNetworkEnvironment(
  process.env,
  launchReceipt,
  pid,
);
// This command retains the current port; changing network topology is a separate action.
if (successorEnvironment.RAH_WEB_PORT)
  assert.equal(
    Number(successorEnvironment.RAH_WEB_PORT),
    port,
    "Incumbent port mismatch",
  );
let staticDirectory, receipt, baseline;
const backupRoot = join(dirname(state), "backups");
await mkdir(backupRoot, { recursive: true, mode: 0o700 });
const target = join(backupRoot, `pre-restart-${randomUUID()}`);
await guardedStop({
  async validate() {
    staticDirectory = await snapshotWorkbenchAssets(repo);
    const metadata = JSON.parse(
      await readFile(join(staticDirectory, ".rah-web-build.json"), "utf8"),
    );
    assert.equal(
      metadata.webBuildId,
      values.build,
      "Unexpected candidate build",
    );
    return true;
  },
  async inspect() {
    baseline = inspect();
    return true;
  },
  async backup() {
    receipt = await backupState(state, target);
    return true;
  },
  async verify() {
    await verifyStateBackup(target, receipt);
    await preflightKernelUpgrade(join(target, "room.db"));
    return true;
  },
  async recheck() {
    assert.deepEqual(await fileInventory(state), {
      files: receipt.files,
      omittedSockets: receipt.omittedSockets,
    });
    assert.deepEqual(
      inspect(),
      baseline,
      "Canonical events changed during backup; retry when idle",
    );
    // Keep a private receipt outside the backed-up state tree.
    await writeFile(
      `${target}.receipt.json`,
      JSON.stringify(
        { schemaVersion: 1, pid, initial, state, build: values.build, receipt },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    return true;
  },
  async stop() {
    assert.deepEqual(inspect(), baseline);
    process.kill(pid, "SIGTERM");
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") return true;
        throw error;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Incumbent did not exit; no force-kill or successor start");
  },
});
process.stdout.write(`Verified backup: ${target}\n`);
// The old writer is stopped before rotation; the new child receives fresh descriptors.
const logDirectory = join(dirname(state), "logs");
const serviceLogs = await openServiceLogs(logDirectory, "core");
process.stdout.write(
  `Workbench logs: ${logDirectory}/core.{stdout,stderr}.log\n`,
);
// Successor still uses the existing launcher/drain implementation and frozen bytes.
const child = spawn(
  process.execPath,
  [join(repo, "scripts/run-local-workbench.mjs")],
  {
    cwd: repo,
    stdio: ["ignore", serviceLogs.stdout.fd, serviceLogs.stderr.fd],
    env: {
      ...successorEnvironment,
      RAH_DATA_HOME: dirname(state),
      RAH_OS_HOME: dirname(state),
      RAH_WEB_STATIC_DIRECTORY: staticDirectory,
      RAH_WEB_PORT: String(port),
      RAH_WORKSPACE_CWD: repo,
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
child.once("error", (error) => {
  throw error;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});

await serviceLogs.close();
