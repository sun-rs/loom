import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeAvatarUrl,
  nativeAvatarKeys,
  nativeRandomAvatar,
} from "../../frontends/raft/adapter123/avatars.ts";
test("new native Roles use the whole pinned preset pool excluding occupied avatars, with an exhausted-pool fallback", () => {
  assert.equal(nativeAvatarKeys.length, 16);
  const used = nativeAvatarKeys.slice(0, -1).map((k) => "pixel:" + k);
  assert.equal(
    nativeRandomAvatar(used, () => 0),
    "pixel:" + nativeAvatarKeys.at(-1),
  );
  assert.equal(
    nativeRandomAvatar(
      nativeAvatarKeys.map((k) => "pixel:" + k),
      () => 0,
    ),
    "pixel:" + nativeAvatarKeys[0],
  );
});
test("native avatars retain original rendering and legacy saved keys remain readable without joining the new picker", () => {
  assert.equal(
    nativeAvatarUrl("pixel:" + nativeAvatarKeys[0]),
    "pixel:" + nativeAvatarKeys[0],
  );
  assert.match(nativeAvatarUrl("pixel:pokemon-001")!, /^\/avatars\/pokemon\//);
  assert.match(nativeAvatarUrl("pixel:loom-openai")!, /^data:image\/svg/);
  assert.equal(nativeAvatarKeys.includes("loom-openai"), false);
});
