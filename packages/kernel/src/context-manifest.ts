import {
  ContextManifestSchema,
  type Activation,
  type AgentRuntimeContext,
  type ContextManifest,
  type PlacementDecision,
} from "@rah-os/protocol";

import { canonicalDigest } from "./canonical-digest.ts";
import { jsonObject, text } from "./sqlite-row.ts";

export function createContextManifest(input: {
  activation: Pick<
    Activation,
    "activationId" | "fromSeq" | "participantId" | "roomId" | "toSeq"
  >;
  agentContext?: AgentRuntimeContext;
  contextManifestId: string;
  createdAt: string;
  placement?: PlacementDecision;
  runAttemptId: string;
}): ContextManifest {
  if ((input.agentContext === undefined) !== (input.placement === undefined)) {
    throw new Error(
      "ContextManifest placement and AgentDefinition must be frozen together",
    );
  }
  const revision = input.agentContext?.agentDefinitionRevision;
  const unsigned = {
    activationId: input.activation.activationId,
    ...(revision === undefined
      ? {}
      : {
          agentDefinition: {
            agentDefinitionRevisionId: revision.agentDefinitionRevisionId,
            contentDigest: revision.contentDigest,
            instructionRefs: revision.instructionRefs,
            memoryPolicyRef: revision.memoryPolicyRef,
            skillRefs: revision.skillRefs,
          },
        }),
    contextManifestId: input.contextManifestId,
    createdAt: input.createdAt,
    eventRanges: [
      {
        fromSeq: input.activation.fromSeq,
        toSeq: input.activation.toSeq,
      },
    ],
    participantId: input.activation.participantId,
    ...(input.placement === undefined
      ? {}
      : {
          placement: {
            placementId: input.placement.placementId,
            runtimeProfileDigest: input.placement.runtimeProfileDigest,
            runtimeProfileRevisionId: input.placement.runtimeProfileRevisionId,
            workspaceDefinitionId: input.placement.workspaceDefinitionId,
            workspaceMode: input.placement.workspaceMode,
            workspaceMountDigest: input.placement.workspaceMountDigest,
            workspaceMountRevisionId: input.placement.workspaceMountRevisionId,
          },
        }),
    roomId: input.activation.roomId,
    runAttemptId: input.runAttemptId,
    schemaVersion: 1 as const,
    throughRoomSeq: input.activation.toSeq,
  };
  return ContextManifestSchema.parse({
    ...unsigned,
    contentDigest: canonicalDigest(unsigned),
  });
}

export function parseStoredContextManifest(value: unknown): ContextManifest {
  const manifest = ContextManifestSchema.parse(value);
  const { contentDigest, ...unsigned } = manifest;
  if (canonicalDigest(unsigned) !== contentDigest) {
    throw new Error("stored ContextManifest content digest does not match");
  }
  return manifest;
}

export function persistContextManifest(
  database: DatabaseSync,
  input: Parameters<typeof createContextManifest>[0],
): ContextManifest {
  const manifest = createContextManifest(input);
  database
    .prepare(
      "INSERT INTO context_manifests(context_manifest_id, run_attempt_id, content_digest, manifest_json, created_at) VALUES(?, ?, ?, ?, ?)",
    )
    .run(
      manifest.contextManifestId,
      manifest.runAttemptId,
      manifest.contentDigest,
      JSON.stringify(manifest),
      manifest.createdAt,
    );
  return manifest;
}

export function contextManifestForRunAttempt(
  database: DatabaseSync,
  runAttemptId: string,
): ContextManifest | undefined {
  const row = database
    .prepare(
      "SELECT content_digest, manifest_json FROM context_manifests WHERE run_attempt_id = ?",
    )
    .get(runAttemptId);
  if (row === undefined) return undefined;
  const manifest = parseStoredContextManifest(jsonObject(row, "manifest_json"));
  if (
    manifest.runAttemptId !== runAttemptId ||
    manifest.contentDigest !== text(row, "content_digest")
  ) {
    throw new Error("stored ContextManifest identity does not match");
  }
  return manifest;
}
import type { DatabaseSync } from "node:sqlite";
