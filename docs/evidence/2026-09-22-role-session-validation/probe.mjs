// Non-model characterization probe. Only temporary synthetic data is touched.
// Success means observations reproduced, NOT new architecture acceptance.
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  chmod,
  rm,
  realpath,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ProviderSessionStore } from "../../../packages/agent-host/src/provider-session-store.ts";
import { resolveRuntimeToolAccessLaunch } from "../../../packages/agent-host/src/runtime-tool-access.ts";

const root = await mkdtemp(join(tmpdir(), "rah-role-characterization-"));
const results = [];
try {
  const key = {
    participantId: "synthetic-instance-a",
    provider: "codex-app-server/v1",
    runtimeProfileRevisionId: "synthetic-profile-v1",
    workspaceMountRevisionId: "synthetic-mount-v1",
  };
  const rootDirectory = join(root, "sessions");
  await new ProviderSessionStore({ rootDirectory }).record(
    key,
    "synthetic-session-a",
  );
  const restored = new ProviderSessionStore({ rootDirectory });
  assert.equal(
    (await restored.load(key)).providerSessionId,
    "synthetic-session-a",
  );
  assert.equal(
    await restored.load({
      ...key,
      runtimeProfileRevisionId: "synthetic-profile-v2",
    }),
    null,
  );
  assert.equal(
    await restored.load({ ...key, participantId: "synthetic-instance-b" }),
    null,
  );
  await restored.record(
    { ...key, participantId: "synthetic-instance-b" },
    "synthetic-session-b",
  );
  assert.equal(
    (await restored.load(key)).providerSessionId,
    "synthetic-session-a",
  );
  results.push({
    probe: "session-store",
    reloadPreservesId: true,
    changedProfileMisses: true,
    distinctParticipantsSeparate: true,
    limit: "store-level only; no model/effort UI or native CLI exercised",
  });

  for (const cli of ["claude", "codex", "kimi", "opencode"]) {
    assert.throws(
      () => resolveRuntimeToolAccessLaunch(`${cli}-cli/v1`, "read_only"),
      /requires full_access/,
    );
  }
  results.push({
    probe: "current-runtime-policy",
    readOnlyRejectedForAllFour: true,
    limit: "existing product policy, not evidence native CLIs cannot sandbox",
  });

  const memoryDir = join(root, "synthetic-memory");
  const memoryPath = join(memoryDir, "MEMORY.md");
  await mkdir(memoryDir, { mode: 0o700 });
  await writeFile(memoryPath, "synthetic original\n", { mode: 0o600 });
  await chmod(memoryPath, 0o400);
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import {chmodSync,writeFileSync} from 'node:fs'; chmodSync(process.argv[1],0o600);writeFileSync(process.argv[1],'synthetic changed\\n');",
      memoryPath,
    ],
    { encoding: "utf8", env: {} },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(await readFile(memoryPath, "utf8"), "synthetic changed\n");
  results.push({
    probe: "same-user-file-mode",
    childCanRestoreWriteAndModify: true,
    limit:
      "no OS sandbox; proves chmod-only is insufficient, not a bypass of an implemented Side sandbox",
  });
  if (process.platform === "darwin") {
    const canonicalDir = await realpath(memoryDir);
    const alias = join(root, "memory-alias");
    await symlink(memoryPath, alias);
    const policy = `(version 1)(allow default)(deny file-write* (subpath ${JSON.stringify(canonicalDir)}))`;
    const sandboxed = spawnSync(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        policy,
        process.execPath,
        "--input-type=module",
        "-e",
        `
      import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
      const paths=process.argv.slice(1);
      const readable=readFileSync(paths[0],'utf8')==='synthetic changed\\n';
      const denied=[];
      for(const path of paths) {
        for(const op of [()=>writeFileSync(path,'unexpected'),()=>chmodSync(path,0o600)]) {
          try { op(); denied.push(false); } catch(e) { denied.push(['EPERM','EACCES'].includes(e.code)); }
        }
      }
      console.log(JSON.stringify({readable,denied}));
    `,
        memoryPath,
        alias,
      ],
      { encoding: "utf8", env: {} },
    );
    if (sandboxed.status === 0) {
      const observation = JSON.parse(sandboxed.stdout);
      assert.equal(observation.readable, true);
      assert.deepEqual(observation.denied, [true, true, true, true]);
      assert.equal(await readFile(memoryPath, "utf8"), "synthetic changed\n");
      results.push({
        probe: "macos-sandbox-primitive",
        ...observation,
        limit:
          "synthetic Node child only; not a complete provider, broker, network or auto-memory isolation test",
      });
    } else {
      results.push({
        probe: "macos-sandbox-primitive",
        status: "blocked",
        error: sandboxed.error?.message ?? sandboxed.stderr.trim(),
        limit:
          "not proof that sandbox enforcement is unavailable on deployment host",
      });
    }
  }
  process.stdout.write(
    JSON.stringify(
      { kind: "characterization-not-release-gate", paidCalls: 0, results },
      null,
      2,
    ) + "\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
