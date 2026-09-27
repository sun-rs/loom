import test from "node:test";
import assert from "node:assert/strict";
import { matchOpenCodeFixtureOrphans } from "./fixture-orphans.mjs";

// FIXTURE process table: paths and pids are fake.
const ROOTS = ["/var/folders/xx/T", "/private/var/folders/xx/T"];
const PS = [
  "  101     1 1-02:03:04 node /var/folders/xx/T/loom-og-record-Iebprc/fake-opencode.mjs serve --pure --hostname 127.0.0.1 --port 52871",
  "  102     1    05:06 node /var/folders/xx/T/loom-og-test-NnuSIW/fake-opencode.mjs serve --pure --hostname 127.0.0.1 --port 49860",
  "  103   900    00:01 /usr/local/bin/node /private/var/folders/xx/T/loom-og-record-AbC123/fake-opencode.mjs serve --pure",
  // Not the fixture: another directory, another script, the real CLI, a
  // non-serve invocation, a lookalike name.
  "  201     1    00:01 node /Users/x/loom-og-record-Iebprc/fake-opencode.mjs serve --pure",
  "  202     1    00:01 node /var/folders/xx/T/loom-og-record-Iebprc/guarded-opencode.mjs serve --pure",
  "  203     1    00:01 opencode serve --pure --hostname 127.0.0.1 --port 4100",
  "  204     1    00:01 node /var/folders/xx/T/loom-og-record-Iebprc/fake-opencode.mjs --version",
  "  205     1    00:01 node /var/folders/xx/T/loom-og-recordX-Iebprc/fake-opencode.mjs serve",
  "  206     1    00:01 grep loom-og-record-Iebprc/fake-opencode.mjs serve",
].join("\n");

test("fixture orphans: exact fake opencode serve script under the temp root only", () => {
  const found = matchOpenCodeFixtureOrphans(PS, ROOTS);
  assert.deepEqual(
    found.map((o) => o.pid),
    [101, 102, 103],
  );
  assert.equal(found[0].ppid, 1);
  assert.equal(found[0].elapsed, "1-02:03:04");
  assert.match(found[2].command, /^\/usr\/local\/bin\/node /u);
});
