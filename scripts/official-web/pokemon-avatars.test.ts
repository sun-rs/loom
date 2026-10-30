import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import {
  AGENT_AVATAR_PRESET_KEYS,
  officialAgentAvatarKey,
  ClientAgentProfileRequestSchema,
  WorkerSelfProfilePatchSchema,
} from "@rah-os/protocol";
import {
  libraryAvatarUrl,
  selectableAvatarKeys,
} from "../../frontends/raft/loom/pixel-avatar-library.ts";
import { SELECTABLE_AGENT_AVATAR_KEYS } from "@rah-os/protocol";

test("all 539 supplied PNG identities remain readable but are no longer selectable", () => {
  const avatars = JSON.parse(
    readFileSync("frontends/raft/loom/avatars/pokemon.json", "utf8"),
  ).avatars;
  assert.equal(avatars.length, 539);
  assert.equal(new Set(avatars.map((a) => a.id)).size, 539);
  assert.equal(avatars.find((a) => a.id === "pokemon-025")?.name, "皮卡丘");
  assert.equal(
    avatars.filter((a) => a.id.startsWith("pokemon-201-")).length,
    28,
  );
  assert.ok(avatars.every((a) => a.id.startsWith("pokemon-")));
  assert.deepEqual(selectableAvatarKeys, SELECTABLE_AGENT_AVATAR_KEYS);
  assert.ok(avatars.every((a) => !selectableAvatarKeys.includes(a.id)));
});

test("all original image bytes are shipped as separate same-origin content-addressed assets", () => {
  const manifest = JSON.parse(
    readFileSync("frontends/raft/loom/avatars/pokemon.provenance.json", "utf8"),
  );
  assert.equal(manifest.avatars.length, 539);
  assert.match(manifest.source.archiveSha256, /^[a-f0-9]{64}$/);
  const files = readdirSync(
    "frontends/raft/packages/web/public/avatars/pokemon",
  );
  assert.equal(files.length, 539);
  for (const a of manifest.avatars) {
    assert.match(
      a.url,
      /^\/avatars\/pokemon\/pokemon-[a-z0-9-]+-[a-f0-9]{16}\.png$/,
    );
    const bytes = readFileSync("frontends/raft/packages/web/public" + a.url);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      a.sha256,
      a.id,
    );
    assert.equal(bytes.readUInt32BE(16), 512, a.id);
    assert.equal(bytes.readUInt32BE(20), 512, a.id);
    assert.equal(bytes.length, a.bytes, a.id);
    assert.equal(libraryAvatarUrl(a.id), a.url);
  }
  assert.equal(libraryAvatarUrl("robot"), null);
  const runtime = JSON.parse(
    readFileSync("frontends/raft/loom/avatars/pokemon.json", "utf8"),
  );
  assert.equal(runtime.avatars.length, 539);
  assert.ok(
    runtime.avatars.every((a) => !a.sha256 && !a.sourcePath),
    "provenance is not bundled into the application",
  );
});

test("every historical PNG identity survives profile authority validation and old stored keys stay readable", () => {
  const avatars = JSON.parse(
    readFileSync("frontends/raft/loom/avatars/pokemon.json", "utf8"),
  ).avatars;
  for (const a of avatars) {
    assert.equal(officialAgentAvatarKey("pixel:" + a.id), a.id);
    assert.equal(
      WorkerSelfProfilePatchSchema.safeParse({ avatarKey: a.id }).success,
      true,
    );
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
  }
  for (const key of ["robot", "cat", "loom-eva-unit01", "loom-pikachu"])
    assert.equal(officialAgentAvatarKey("pixel:" + key), key);
  assert.ok(AGENT_AVATAR_PRESET_KEYS.includes("pokemon-025"));
});
