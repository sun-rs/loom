import assert from "node:assert/strict";
import test from "node:test";

import { ContextManifestSchema } from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function manifest() {
  return {
    activationId: "activation-context-1",
    agentDefinition: {
      agentDefinitionRevisionId: "agent-definition-revision-1",
      contentDigest: digest("a"),
      instructionRefs: [
        {
          artifactId: "instructions-main",
          contentDigest: digest("b"),
          versionId: "instructions-main-v1",
        },
      ],
      memoryPolicyRef: {
        artifactId: "memory-policy",
        contentDigest: digest("c"),
        versionId: "memory-policy-v1",
      },
      skillRefs: [],
    },
    contentDigest: digest("d"),
    contextManifestId: "context-manifest-1",
    createdAt: "2026-08-28T00:00:00.000Z",
    eventRanges: [{ fromSeq: 2, toSeq: 5 }],
    participantId: "agent-context-1",
    placement: {
      placementId: "placement-context-1",
      runtimeProfileDigest: digest("e"),
      runtimeProfileRevisionId: "runtime-profile-revision-1",
      workspaceDefinitionId: "workspace-context-1",
      workspaceMode: "in_place" as const,
      workspaceMountDigest: digest("f"),
      workspaceMountRevisionId: "workspace-mount-revision-1",
    },
    roomId: "room-context-1",
    runAttemptId: "run-context-1",
    schemaVersion: 1 as const,
    throughRoomSeq: 5,
  };
}

test("ContextManifest freezes exact Room, Agent, Runtime, Workspace, and content references", () => {
  assert.deepEqual(ContextManifestSchema.parse(manifest()), manifest());
  assert.throws(() =>
    ContextManifestSchema.parse({ ...manifest(), throughRoomSeq: 6 }),
  );
  assert.throws(() =>
    ContextManifestSchema.parse({ ...manifest(), agentDefinition: undefined }),
  );
  assert.throws(() =>
    ContextManifestSchema.parse({
      ...manifest(),
      agentDefinition: {
        ...manifest().agentDefinition,
        skillRefs: manifest().agentDefinition.instructionRefs,
      },
    }),
  );
});
