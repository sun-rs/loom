import assert from "node:assert/strict";
import test from "node:test";
import { isRaftUploadedHumanAvatarUrl as accepts } from "../../frontends/raft/loom/profile-avatar.ts";
test("Native avatar accepts only Loom's root-scoped uploaded image endpoint", () => {
  const path = "/v3/client/profile-images/content/upload_png_" + "a".repeat(40);
  assert.equal(accepts(path), true);
  for (const value of [
    null,
    "",
    "https://external.test" + path,
    "//external.test" + path,
    path + "?token=x",
    path + "/other",
    "/etc/passwd",
    "data:image/png;base64,a",
  ])
    assert.equal(accepts(value), false);
});
