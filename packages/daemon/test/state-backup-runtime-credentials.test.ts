import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
  access,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { backupState, verifyStateBackup } from "../src/state-backup.ts";

test("backup preserves durable session bindings without copying or widening hot turn credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-backup-turns-"));
  const state = join(root, "state");
  const relative =
    "warm-runtimes/instrt_11111111-1111-4111-8111-111111111111/turns";
  const turns = join(state, relative);
  try {
    await mkdir(join(turns, "known-handle"), { recursive: true });
    await writeFile(join(turns, "known-handle/token"), "ephemeral-secret");
    await chmod(turns, 0o300);
    await mkdir(join(state, "supervisors/provider-sessions"), {
      recursive: true,
    });
    await writeFile(
      join(state, "supervisors/provider-sessions/session.json"),
      '{"session":"same-session"}',
    );
    const target = join(root, "backup");
    const receipt = await backupState(state, target);
    assert.equal((await stat(turns)).mode & 0o777, 0o300);
    assert.equal(
      await readFile(
        join(target, "supervisors/provider-sessions/session.json"),
        "utf8",
      ),
      '{"session":"same-session"}',
    );
    await assert.rejects(access(join(target, relative)), { code: "ENOENT" });
    assert.deepEqual(receipt.omittedRuntimeCredentials, [relative]);
    assert.equal(await verifyStateBackup(target, receipt), true);
    // Verification must not hide a credential inserted into the backup.
    await mkdir(join(target, relative), { recursive: true });
    await writeFile(join(target, relative, "token"), "unexpected");
    await assert.rejects(verifyStateBackup(target, receipt));
  } finally {
    await chmod(turns, 0o700).catch(() => {});
    await rm(root, { force: true, recursive: true });
  }
});

test("backup exclusions do not hide unrelated unreadable directories or credential symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-backup-boundary-"));
  const state = join(root, "state");
  const unrelated = join(state, "unrelated/turns");
  try {
    await mkdir(unrelated, { recursive: true });
    await chmod(unrelated, 0o300);
    await assert.rejects(backupState(state, join(root, "backup-1")), {
      code: "EACCES",
    });
    await chmod(unrelated, 0o700);
    const runtime = join(
      state,
      "warm-runtimes/instrt_11111111-1111-4111-8111-111111111111",
    );
    await mkdir(runtime, { recursive: true });
    await symlink(unrelated, join(runtime, "turns"));
    await assert.rejects(
      backupState(state, join(root, "backup-2")),
      /symlink refused/u,
    );
  } finally {
    await chmod(unrelated, 0o700).catch(() => {});
    await rm(root, { force: true, recursive: true });
  }
});
