import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  officialAgentAvatarKey,
  ClientAgentProfileRequestSchema,
  WorkerSelfProfilePatchSchema,
} from "@rah-os/protocol";
import {
  AGENT_AVATAR_PRESET_KEYS,
  OFFICIAL_AGENT_AVATAR_KEYS,
  availableAgentAvatarKeys,
} from "@rah-os/protocol";
import library, {
  randomAvatarKey,
} from "../../frontends/raft/loom/pixel-avatar-library.ts";
const extra = JSON.parse(
  readFileSync("frontends/raft/loom/avatars/presets.json", "utf8"),
);
test("random button and server defaults share the distinct unoccupied pool; exhaustion reuses the full catalog", () => {
  const used = ["pixel:robot", "pixel:robot", "pixel:cat"];
  const pool = availableAgentAvatarKeys(used);
  assert.equal(pool.length, OFFICIAL_AGENT_AVATAR_KEYS.length - 2);
  assert.ok(!pool.includes("robot") && !pool.includes("cat"));
  for (const n of [0, 0.25, 0.5, 0.99999])
    assert.ok(!used.includes(randomAvatarKey(undefined, () => n, used)));
  assert.deepEqual(
    availableAgentAvatarKeys(OFFICIAL_AGENT_AVATAR_KEYS),
    OFFICIAL_AGENT_AVATAR_KEYS,
  );
  const soleUnused = OFFICIAL_AGENT_AVATAR_KEYS.at(-1)!;
  assert.equal(
    randomAvatarKey("pixel:robot", () => 0, OFFICIAL_AGENT_AVATAR_KEYS),
    "pixel:" + OFFICIAL_AGENT_AVATAR_KEYS[0],
    "exhaustion uses the whole pool, including the current preset",
  );
  assert.equal(
    randomAvatarKey(
      `pixel:${soleUnused}`,
      () => 0,
      OFFICIAL_AGENT_AVATAR_KEYS.slice(0, -1),
    ),
    `pixel:${soleUnused}`,
  );
});
test("legacy grids stay immutable; random creation uses only the current official library", () => {
  const native = JSON.parse(
    readFileSync(
      "frontends/raft/upstream/raft-web-source/packages/web/assets/avatars/pixelAvatars.json",
      "utf8",
    ),
  );
  for (const [key, color] of Object.entries(native.palette))
    assert.equal(library.palette[key], color);
  for (const [id, data] of Object.entries(native.avatars))
    assert.deepEqual(library.avatars[id], data);
  assert.equal(
    AGENT_AVATAR_PRESET_KEYS.length,
    Object.keys(library.avatars).length - native.reservedKeys.length + 539,
  );
  const first = randomAvatarKey(undefined, () => 0),
    last = randomAvatarKey(undefined, () => 0.99999);
  assert.notEqual(first, last);
  assert.notEqual(
    randomAvatarKey(first, () => 0),
    first,
  );
  for (const value of [first, last]) {
    assert.ok(AGENT_AVATAR_PRESET_KEYS.includes(value.slice(6)));
    assert.ok(!native.reservedKeys.includes(value.slice(6)));
  }
});
test("historical 32x32 identities remain renderable for stored Roles and frozen instances", () => {
  const native = JSON.parse(
    readFileSync(
      "frontends/raft/upstream/raft-web-source/packages/web/assets/avatars/pixelAvatars.json",
      "utf8",
    ),
  );
  assert.equal(
    new Set(extra.avatars.map((a) => a.id)).size,
    extra.avatars.length,
  );
  for (const a of extra.avatars) {
    assert.ok(!native.avatars[a.id]);
    const rows = a.grid.split("/");
    assert.equal(rows.length, 32, a.id);
    for (const r of rows) {
      assert.equal(r.length, 32, a.id);
      for (const c of r) assert.ok(c in library.palette, a.id + " " + c);
    }
    assert.ok(extra.groups.some((g) => g.id === a.group));
  }
  for (const id of [
    "gemini",
    "kimi",
    "openai",
    "codex",
    "claude",
    "anthropic",
    "deepseek",
    "grok",
    "muse",
    "glm",
    "eva-unit01",
    "eva-unit02",
    "geass-lelouch",
    "geass-cc",
    "doraemon",
    "nobita",
    "pikachu",
    "raichu",
    "squirtle",
    "wartortle",
    "blastoise",
    "bulbasaur",
    "ivysaur",
    "venusaur",
    "charmander",
    "charmeleon",
    "charizard",
    "lapras",
    "snorlax",
    "zapdos",
    "moltres",
    "articuno",
    "mewtwo",
    "gastly",
    "haunter",
    "gengar",
    "mew",
  ])
    assert.ok(
      extra.avatars.some((a) => a.id === "loom-" + id),
      id,
    );
});
test("new presets survive instance presentation and the existing profile authority contract", () => {
  for (const a of extra.avatars) {
    assert.equal(officialAgentAvatarKey("pixel:" + a.id, "principal"), a.id);
    assert.equal(
      ClientAgentProfileRequestSchema.safeParse({
        action: "update_profile",
        agentId: "a",
        expectedRevisionId: "r",
        basedOnRoomSeq: 0,
        idempotencyKey: "key",
        field: "avatarKey",
        value: a.id,
      }).success,
      true,
    );
    assert.equal(
      WorkerSelfProfilePatchSchema.safeParse({ avatarKey: a.id }).success,
      true,
    );
  }
  assert.equal(
    WorkerSelfProfilePatchSchema.safeParse({ avatarKey: "arbitrary" }).success,
    false,
  );
});
