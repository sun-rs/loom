import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workerTurnRules } from "./worker-turn-sandbox.mjs";
const mac = process.platform === "darwin";
const instance = "instrt_11111111-1111-1111-1111-111111111111";
const handle = "abcdefghijklmnopqr_1-2";
function fixture(t) {
  const base = realpathSync(
    mkdtempSync(join(tmpdir(), "loom-worker.sandbox-")),
  );
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "warm-runtimes", instance, "turns");
  const current = join(root, handle);
  mkdirSync(current, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  for (const name of ["scope.json", "token", "extra"])
    writeFileSync(join(current, name), "SYNTHETIC " + name, { mode: 0o600 });
  return { base, root, current };
}
test("missing turn root adds no authority", () =>
  assert.equal(workerTurnRules(undefined), ""));
test("reject invalid root, nonprivate directory and symbolic root", (t) => {
  const { base, root } = fixture(t);
  assert.throws(() => workerTurnRules("relative"));
  assert.throws(() => workerTurnRules(base));
  chmodSync(root, 0o755);
  assert.throws(() => workerTurnRules(root));
  chmodSync(root, 0o700);
  const link = join(base, "link");
  symlinkSync(root, link);
  assert.throws(() => workerTurnRules(link));
});
test(
  "Seatbelt allows exact scope/token while denying sibling/oracle/list",
  { skip: !mac && "Requires macOS Seatbelt" },
  (t) => {
    const { base, root, current } = fixture(t);
    const sibling = join(
      base,
      "warm-runtimes",
      "instrt_22222222-2222-2222-2222-222222222222",
      "turns",
      handle,
    );
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, "token"), "PEER");
    const oracle = join(base, "oracle");
    writeFileSync(oracle, "ORACLE");
    const bad = join(root, "short");
    mkdirSync(bad);
    writeFileSync(join(bad, "token"), "WRONG HANDLE");
    const profile = join(base, "profile.sb");
    writeFileSync(
      profile,
      "(version 1)\n(allow default)\n(deny file-read* (subpath " +
        JSON.stringify(base) +
        "))\n" +
        workerTurnRules(root),
    );
    const run = (exe, args) =>
      spawnSync("/usr/bin/sandbox-exec", ["-f", profile, exe, ...args], {
        encoding: "utf8",
      });
    for (const name of ["scope.json", "token"]) {
      const r = run("/bin/cat", [join(current, name)]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "SYNTHETIC " + name);
    }
    for (const path of [
      join(current, "extra"),
      join(sibling, "token"),
      oracle,
      join(bad, "token"),
    ]) {
      const r = run("/bin/cat", [path]);
      assert.notEqual(r.status, 0);
      assert.equal(r.stdout, "");
    }
    const listing = run("/bin/ls", [root]);
    assert.notEqual(listing.status, 0);
    assert.equal(listing.stdout, "");
  },
);
