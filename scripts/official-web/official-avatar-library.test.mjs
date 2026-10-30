import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateOfficialAvatars } from "./generate-official-avatars.mjs";
import {
  avatarGroups,
  selectableAvatarKeys,
  randomAvatarKey,
} from "../../frontends/raft/loom/pixel-avatar-library.ts";
import {
  OFFICIAL_AGENT_AVATAR_KEYS,
  SELECTABLE_AGENT_AVATAR_KEYS,
  officialAgentAvatarKey,
  WorkerSelfProfilePatchSchema,
} from "@rah-os/protocol";

const generated = await generateOfficialAvatars();
test("the official avatar data and identities are reproducible from the whole pinned Web release", () => {
  for (const [path, source] of Object.entries(generated.files))
    assert.equal(readFileSync(path, "utf8"), source, path);
  assert.equal(generated.catalog.series.length, 9);
  assert.equal(Object.keys(generated.catalog.avatars).length, 74);
  assert.deepEqual(generated.catalog.reservedKeys, ["finch", "mug"]);
  assert.equal(generated.keys.length, 72);
});

test("the active picker uses native series order, native Chinese labels and all 72 original sprites", () => {
  assert.deepEqual(
    avatarGroups.map((g) => g.id),
    generated.catalog.series.map((g) => g.key),
  );
  assert.deepEqual(
    avatarGroups.map((g) => g.name),
    [
      "机器人家族",
      "小动物",
      "太空",
      "工位",
      "食物",
      "冒险",
      "天气",
      "植物",
      "怪谈",
    ],
  );
  for (const [index, group] of avatarGroups.entries())
    assert.deepEqual(
      group.avatars.map((a) => a.id),
      generated.catalog.series[index].avatars,
    );
  assert.deepEqual(selectableAvatarKeys, generated.keys);
  assert.deepEqual(SELECTABLE_AGENT_AVATAR_KEYS, generated.keys);
  assert.deepEqual(OFFICIAL_AGENT_AVATAR_KEYS, generated.keys);
  for (const key of generated.keys) {
    assert.equal(officialAgentAvatarKey("pixel:" + key), key);
    assert.equal(
      WorkerSelfProfilePatchSchema.safeParse({ avatarKey: key }).success,
      true,
      key,
    );
  }
  for (const n of [0, 0.5, 0.99999]) {
    const key = randomAvatarKey(undefined, () => n);
    assert.ok(generated.keys.includes(key.slice(6)));
    assert.notEqual(
      randomAvatarKey(key, () => n),
      key,
    );
  }
  assert.equal(
    officialAgentAvatarKey("pixel:pokemon-025"),
    "pokemon-025",
    "stored artwork remains readable",
  );
});
