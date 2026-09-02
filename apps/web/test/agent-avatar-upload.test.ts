import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_AVATAR_UPLOAD_ACCEPT,
  uploadAgentAvatar,
} from "../src/agent-avatar-upload.ts";

test("Agent avatar upload stores content before saving the exact canonical revision", async () => {
  const calls: string[] = [];
  const file = new File(["avatar"], "avatar.png", { type: "image/png" });
  const avatarKey = `upload_png_${"a".repeat(40)}`;
  const result = await uploadAgentAvatar({
    agentDefinitionId: "agent",
    expectedRevisionId: "revision-7",
    file,
    saveProfile: async (input) => {
      calls.push(`save:${input.expectedRevisionId}:${input.value}`);
    },
    upload: async (candidate) => {
      calls.push(`upload:${candidate.name}`);
      return { avatarKey };
    },
  });
  assert.equal(result, avatarKey);
  assert.deepEqual(calls, [
    "upload:avatar.png",
    `save:revision-7:${avatarKey}`,
  ]);
  assert.equal(
    AGENT_AVATAR_UPLOAD_ACCEPT,
    "image/jpeg,image/png,image/gif,image/webp",
  );
});

test("Agent avatar upload never saves a profile after content upload failure", async () => {
  let saved = false;
  await assert.rejects(
    uploadAgentAvatar({
      agentDefinitionId: "agent",
      expectedRevisionId: "revision",
      file: new File(["bad"], "bad.png", { type: "image/png" }),
      saveProfile: async () => {
        saved = true;
      },
      upload: async () => {
        throw new Error("invalid image");
      },
    }),
    /invalid image/u,
  );
  assert.equal(saved, false);
});
