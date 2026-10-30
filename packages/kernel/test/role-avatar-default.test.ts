import test from "node:test";
import assert from "node:assert/strict";
import { roleInstanceFixture } from "./role-instance-fixture.ts";
import { OFFICIAL_AGENT_AVATAR_KEYS } from "@rah-os/protocol";
test("Role creation chooses and persists an avatar once after idempotency replay; explicit avatars stay intact", () => {
  const f = roleInstanceFixture();
  try {
    const { avatarKey, ...configuration } = f.role.configuration;
    const input = {
      controlRoomId: f.role.controlRoomId,
      basedOnRoomSeq: f.head(f.role.controlRoomId),
      idempotencyKey: "random-avatar",
      configuration: { ...configuration, displayName: "New role" },
    };
    const created = f.kernel.roles.create(f.actor, input);
    assert.ok(
      OFFICIAL_AGENT_AVATAR_KEYS.includes(
        (created.role.configuration.avatarKey ?? "").replace(/^pixel:/, ""),
      ),
      "new Roles use the official library, never historical Pokémon or custom art",
    );
    assert.deepEqual(f.kernel.roles.create(f.actor, input).role, created.role);
    assert.equal(
      f.kernel.roles.create(f.actor, {
        ...input,
        basedOnRoomSeq: f.head(f.role.controlRoomId),
        idempotencyKey: "explicit-avatar",
        configuration: {
          ...configuration,
          displayName: "Explicit role",
          avatarKey: "pixel:loom-eva-unit01",
        },
      }).role.configuration.avatarKey,
      "pixel:loom-eva-unit01",
    );
  } finally {
    f.close();
  }
});
test("automatic Role avatars exhaust unused presets before recycling; manual duplicates remain allowed", () => {
  const f = roleInstanceFixture();
  try {
    const { avatarKey, ...configuration } = f.role.configuration;
    const used = new Set([avatarKey]);
    for (let i = 1; i < OFFICIAL_AGENT_AVATAR_KEYS.length; i++) {
      const role = f.kernel.roles.create(f.actor, {
        controlRoomId: f.role.controlRoomId,
        basedOnRoomSeq: f.head(f.role.controlRoomId),
        idempotencyKey: `unused-${i}`,
        configuration: { ...configuration, displayName: `Unused ${i}` },
      }).role;
      assert.ok(
        !used.has(role.configuration.avatarKey),
        "automatic selection repeated an occupied preset",
      );
      used.add(role.configuration.avatarKey);
    }
    const create = (key: string, avatar?: string) =>
      f.kernel.roles.create(f.actor, {
        controlRoomId: f.role.controlRoomId,
        basedOnRoomSeq: f.head(f.role.controlRoomId),
        idempotencyKey: key,
        configuration: {
          ...configuration,
          displayName: key,
          ...(avatar ? { avatarKey: avatar } : {}),
        },
      }).role;
    assert.ok(
      used.has(create("exhausted").configuration.avatarKey),
      "full pool is reusable after exhaustion",
    );
    assert.equal(
      create("manual duplicate", avatarKey).configuration.avatarKey,
      avatarKey,
    );
  } finally {
    f.close();
  }
});
test("Role uploaded images bind an owned intent and immutable revisions protect content from GC", () => {
  let now = new Date("2026-10-30T00:00:00Z");
  const f = roleInstanceFixture({ now: () => now });
  const key = `upload_png_${"d".repeat(40)}`;
  try {
    const receipt = f.kernel.profileImages.recordUpload(f.actor, {
      avatarKey: key,
    });
    const request = {
      roleId: f.role.roleId,
      expectedRoleRevisionId: f.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.role.controlRoomId),
      idempotencyKey: "upload-role",
      avatarUploadIntentId: receipt.uploadIntentId,
      configuration: { ...f.role.configuration, avatarKey: key },
    };
    const saved = f.kernel.roles.revise(f.actor, request);
    assert.equal(saved.role.configuration.avatarKey, key);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM profile_image_upload_intents").get()!
        .n,
      0,
    );
    assert.equal(f.kernel.roles.revise(f.actor, request).deduplicated, true);
    f.kernel.roles.revise(f.actor, {
      ...request,
      avatarUploadIntentId: undefined,
      idempotencyKey: "restore-preset",
      expectedRoleRevisionId: saved.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.role.controlRoomId),
      configuration: f.role.configuration,
    });
    now = new Date(now.getTime() + 3600_000);
    const reclaimed: string[] = [];
    f.kernel.profileImages.reconcile({
      reclaimBlob: (avatar) => reclaimed.push(avatar),
    });
    assert.ok(
      !reclaimed.includes(key),
      "historical Role revision must retain its uploaded image",
    );
    const otherKey = `upload_png_${"e".repeat(40)}`;
    const otherUpload = f.kernel.profileImages.recordUpload(f.actor, {
      avatarKey: otherKey,
    });
    assert.throws(
      () =>
        f.kernel.roles.create(f.actor, {
          controlRoomId: f.role.controlRoomId,
          basedOnRoomSeq: f.head(f.role.controlRoomId),
          idempotencyKey: "no-intent",
          configuration: {
            ...f.role.configuration,
            displayName: "No intent",
            avatarKey: otherKey,
          },
        }),
      /intent|referenced/,
    );
    assert.throws(() =>
      f.kernel.roles.create(f.actor, {
        controlRoomId: f.role.controlRoomId,
        basedOnRoomSeq: 0,
        idempotencyKey: "stale-upload",
        avatarUploadIntentId: otherUpload.uploadIntentId,
        configuration: {
          ...f.role.configuration,
          displayName: "Stale upload",
          avatarKey: otherKey,
        },
      }),
    );
    assert.ok(
      f.db
        .prepare(
          "SELECT 1 FROM profile_image_upload_intents WHERE upload_intent_id=?",
        )
        .get(otherUpload.uploadIntentId),
      "rejected stale writes cannot consume the upload receipt",
    );
    const created = f.kernel.roles.create(f.actor, {
      controlRoomId: f.role.controlRoomId,
      basedOnRoomSeq: f.head(f.role.controlRoomId),
      idempotencyKey: "new-upload",
      avatarUploadIntentId: otherUpload.uploadIntentId,
      configuration: {
        ...f.role.configuration,
        displayName: "New upload",
        avatarKey: otherKey,
      },
    }).role;
    assert.equal(created.configuration.avatarKey, otherKey);
  } finally {
    f.close();
  }
});
test("Role remarks/prompt/avatar revisions preserve frozen instances and reach only new instances", () => {
  const f = roleInstanceFixture();
  try {
    const before = f.kernel.getWorkspaceAgentManagementView(
      f.actor,
      f.instance.agentId,
    ).agent.currentRevision;
    const revised = f.kernel.roles.revise(f.actor, {
      roleId: f.role.roleId,
      expectedRoleRevisionId: f.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.role.controlRoomId),
      idempotencyKey: "metadata-revision",
      configuration: {
        ...f.role.configuration,
        description: "Display note only",
        role: f.role.configuration.displayName,
        instructions: "Executable instructions only",
        avatarKey: "pixel:loom-eva-unit01",
      },
    }).role;
    assert.deepEqual(
      f.kernel.getWorkspaceAgentManagementView(f.actor, f.instance.agentId)
        .agent.currentRevision,
      before,
    );
    const next = f.kernel.roles.instantiate(f.actor, {
      roleId: revised.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "new-identity-instance",
    });
    assert.equal(next.agent.currentRevision.description, "Display note only");
    assert.equal(
      next.agent.currentRevision.instructions,
      "Executable instructions only",
    );
    assert.equal(next.agent.currentRevision.avatarKey, "pixel:loom-eva-unit01");
  } finally {
    f.close();
  }
});
test("blank Role prompt creates, revises and instantiates without manufacturing instructions", () => {
  const f = roleInstanceFixture();
  try {
    const role = f.kernel.roles.create(f.actor, {
      controlRoomId: f.role.controlRoomId,
      basedOnRoomSeq: f.head(f.role.controlRoomId),
      idempotencyKey: "empty-prompt",
      configuration: {
        ...f.role.configuration,
        displayName: "Empty prompt",
        instructions: "",
      },
    }).role;
    assert.equal(role.configuration.instructions, "");
    const instance = f.kernel.roles.instantiate(f.actor, {
      roleId: role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "empty-instance",
    });
    assert.equal(instance.agent.currentRevision.instructions, "");
    const revised = f.kernel.roles.revise(f.actor, {
      roleId: role.roleId,
      expectedRoleRevisionId: role.roleRevisionId,
      basedOnRoomSeq: f.head(f.role.controlRoomId),
      idempotencyKey: "empty-revise",
      configuration: {
        ...role.configuration,
        description: "Display note",
        instructions: "",
      },
    }).role;
    assert.equal(revised.configuration.instructions, "");
  } finally {
    f.close();
  }
});
