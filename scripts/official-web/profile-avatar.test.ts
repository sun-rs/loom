import assert from "node:assert/strict";
import test from "node:test";
import {
  isRaftUploadedHumanAvatarUrl as accepts,
  roleAvatarUrl,
} from "../../frontends/raft/loom/profile-avatar.ts";
test("persisted Role upload keys resolve through the existing same-origin content endpoint", () => {
  const key = "upload_png_" + "b".repeat(40);
  assert.equal(roleAvatarUrl(key), "/v3/client/profile-images/content/" + key);
  assert.equal(roleAvatarUrl("pixel:owl"), "pixel:owl");
  assert.equal(roleAvatarUrl(null), null);
});
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
