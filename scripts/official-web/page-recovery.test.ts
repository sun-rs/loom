import test from "node:test";
import assert from "node:assert/strict";
import { requestPageReload } from "../../frontends/raft/loom/page-recovery.ts";
test("recovery never reloads while an existing write owner is unresolved", () => {
  let reloads = 0;
  assert.equal(
    requestPageReload(
      () => true,
      () => reloads++,
    ),
    false,
  );
  assert.equal(reloads, 0);
  assert.equal(
    requestPageReload(
      () => false,
      () => reloads++,
    ),
    true,
  );
  assert.equal(reloads, 1);
});
