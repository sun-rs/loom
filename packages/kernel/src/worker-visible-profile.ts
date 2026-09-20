import { visibleWorkerCreatedAgents } from "./worker-profile-created-agents.ts";
import {
  publicComputerMetadata,
  publicRuntimeMetadata,
  type WorkerProfileMetadataPort,
} from "./worker-profile-metadata-port.ts";
import { workerProfileLifecycle } from "./worker-profile-lifecycle.ts";
import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import { fromRow as principalFromRow } from "./principal-profile.ts";
import { nullableText, text, type Row } from "./sqlite-row.ts";
import type { WorkerVisibleRoomScope } from "./worker-read-targets.ts";

// No role/instructions, private memory, env, argv, transcript or hidden-Room Run is projected.
export function visibleWorkerProfile(
  db: DatabaseSync,
  scope: WorkerVisibleRoomScope,
  row: Row,
  now: Date = new Date(),
  metadata?: WorkerProfileMetadataPort,
  paging?: Pick<
    P.WorkerProfileReadRequest,
    "createdAgentsLimit" | "createdAgentsCursor"
  >,
): P.WorkerVisibleProfile {
  const principal = principalFromRow(row),
    definitionId = nullableText(row, "agent_definition_id"),
    state = nullableText(row, "agent_state");
  const description =
      nullableText(row, "agent_description") ?? principal.description,
    avatarKey = nullableText(row, "agent_avatar_key") ?? principal.avatarKey;
  const definition = definitionId
    ? db
        .prepare(
          "SELECT a.*,r.execution_policy_revision_id,p.policy_json FROM agent_definitions a JOIN agent_definition_revisions r ON r.agent_definition_revision_id=a.current_revision_id JOIN execution_policy_revisions p ON p.execution_policy_revision_id=r.execution_policy_revision_id WHERE a.agent_definition_id=?",
        )
        .get(definitionId)
    : undefined;
  const first = definitionId
    ? db
        .prepare(
          "SELECT created_by FROM agent_definition_revisions WHERE agent_definition_id=? ORDER BY revision LIMIT 1",
        )
        .get(definitionId)
    : undefined;
  const creator = first
    ? db
        .prepare(
          "SELECT p.* FROM principals p JOIN memberships m USING(principal_id) WHERE m.room_id=? AND p.principal_id=?",
        )
        .get(scope.roomId, text(first, "created_by"))
    : undefined;
  const run = db
    .prepare(
      "SELECT r.*,p.runtime_offer_id,p.runtime_profile_id,p.runtime_profile_revision_id,json_extract(p.decision_json,'$.resolvedModel') AS resolved_model FROM run_attempts r LEFT JOIN placements p USING(placement_id) WHERE r.participant_id=? AND r.room_id=? ORDER BY r.started_at DESC,r.rowid DESC LIMIT 1",
    )
    .get(principal.principalId, scope.roomId);
  const base = {
    principal,
    displayName:
      nullableText(row, "agent_display_name") ??
      principal.displayName ??
      principal.handle,
    ...(description !== undefined ? { description } : {}),
    ...(avatarKey !== undefined ? { avatarKey } : {}),
    isSelf: principal.principalId === scope.participantId,
    ...(definitionId ? { agentId: definitionId } : {}),
    ...(state ? { agentState: state } : {}),
    ...workerProfileLifecycle(db, scope, row, definitionId, now),
    creator: creator ? person(creator) : null,
    configured: definition ? configuration(db, definition, metadata) : null,
    actualRun: run ? actualRun(db, run, metadata) : null,
  };
  return P.WorkerVisibleProfileSchema.parse({
    ...base,
    ...visibleWorkerCreatedAgents(
      db,
      scope,
      principal.principalId,
      paging ?? {},
      (child) => {
        const configured = configuration(db, child, metadata);
        return {
          ...person(child),
          agentId: text(child, "agent_definition_id"),
          state: text(child, "agent_state"),
          runtimes: configured.runtimeTargets.map((target) => ({
            runtimeOfferId: target.runtimeOfferId,
            registered: target.registered,
            ...("runtime" in target && target.runtime
              ? { runtime: target.runtime }
              : {}),
          })),
          runtimesTruncated: configured.runtimeTargetsTruncated,
        };
      },
      Buffer.byteLength(JSON.stringify(base)),
    ),
  });
}
function person(row: Row) {
  const avatar =
    nullableText(row, "agent_avatar_key") ?? nullableText(row, "avatar_key");
  return {
    participantId: text(row, "principal_id"),
    kind: text(row, "kind"),
    handle: text(row, "handle"),
    displayName:
      nullableText(row, "agent_display_name") ??
      nullableText(row, "display_name") ??
      text(row, "handle"),
    ...(avatar ? { avatarKey: avatar } : {}),
  };
}
function computer(
  db: DatabaseSync,
  hostId: string,
  metadata?: WorkerProfileMetadataPort,
) {
  const h = db
    .prepare(
      "SELECT state,build_version,last_seen_at FROM agent_hosts WHERE host_id=?",
    )
    .get(hostId);
  return {
    hostId,
    ...publicComputerMetadata(metadata, hostId),
    ...(h
      ? {
          observedState: text(h, "state"),
          observedAt: text(h, "last_seen_at"),
          ...(nullableText(h, "build_version")
            ? { reportedBuildVersion: text(h, "build_version") }
            : {}),
        }
      : {}),
  };
}
function configuration(
  db: DatabaseSync,
  definition: Row,
  metadata?: WorkerProfileMetadataPort,
) {
  const policy = P.ExecutionPolicyRevisionSchema.parse(
      JSON.parse(text(definition, "policy_json")),
    ),
    ids = policy.required.allowedOfferIds ?? [],
    bindingIds = policy.modelIntent.exactBindingIds ?? [];
  return {
    ...(policy.modelIntent.customModel
      ? { customModelId: policy.modelIntent.customModel.modelId }
      : {}),
    modelSelection: policy.modelIntent.customModel
      ? "custom_model"
      : bindingIds.length
        ? "binding_ids"
        : policy.modelIntent.capabilityClass
          ? "capability_class"
          : "runtime_default",
    ...(policy.modelIntent.capabilityClass
      ? { capabilityClass: policy.modelIntent.capabilityClass }
      : {}),
    runtimeTargetsRestricted: policy.required.allowedOfferIds !== undefined,
    modelBindingIds: bindingIds.slice(0, 16),
    modelBindingIdsTruncated: bindingIds.length > 16,
    reasoning: policy.modelIntent.reasoning ?? "default",
    toolAccessMode: policy.toolAccessMode,
    runtimeTargetsTruncated: ids.length > 16,
    runtimeTargets: ids.slice(0, 16).map((id) => {
      const offer = db
        .prepare(
          "SELECT runtime_profile_id,runtime_profile_revision_id,host_id,json_extract(offer_json,'$.protocolFamily') AS protocol_family FROM runtime_offers WHERE runtime_offer_id=?",
        )
        .get(id);
      if (!offer)
        return {
          runtimeOfferId: id,
          registered: false,
          models: [],
          modelsTruncated: false,
        };
      const models = db
        .prepare(
          `SELECT json_extract(b.value,'$.modelBindingId') AS binding_id,json_extract(b.value,'$.provider') AS provider,json_extract(b.value,'$.modelId') AS model_id FROM runtime_offers o,json_each(o.offer_json,'$.modelBindingDescriptors') b WHERE o.runtime_offer_id=? AND (?=0 OR json_extract(b.value,'$.modelBindingId') IN (SELECT value FROM json_each(?))) LIMIT 17`,
        )
        .all(id, bindingIds.length, JSON.stringify(bindingIds));
      return {
        runtimeOfferId: id,
        registered: true,
        runtimeProfileId: text(offer, "runtime_profile_id"),
        runtimeProfileRevisionId: text(offer, "runtime_profile_revision_id"),
        runtime: publicRuntimeMetadata(metadata, {
          hostId: text(offer, "host_id"),
          runtimeProfileId: text(offer, "runtime_profile_id"),
          runtimeProfileRevisionId: text(offer, "runtime_profile_revision_id"),
        }),
        ...(nullableText(offer, "protocol_family")
          ? { protocolFamily: text(offer, "protocol_family") }
          : {}),
        computer: computer(db, text(offer, "host_id"), metadata),
        models: models.slice(0, 16).map((m) => ({
          modelBindingId: text(m, "binding_id"),
          provider: text(m, "provider"),
          modelId: text(m, "model_id"),
        })),
        modelsTruncated: models.length > 16,
      };
    }),
  };
}
function actualRun(
  db: DatabaseSync,
  row: Row,
  metadata?: WorkerProfileMetadataPort,
) {
  const raw = nullableText(row, "resolved_model"),
    parsed = raw ? P.ResolvedModelSchema.safeParse(JSON.parse(raw)) : undefined;
  const model = parsed?.success ? parsed.data : null;
  return {
    runAttemptId: text(row, "run_attempt_id"),
    state: text(row, "state"),
    startedAt: text(row, "started_at"),
    ...(nullableText(row, "finished_at")
      ? { finishedAt: text(row, "finished_at") }
      : {}),
    computer: computer(db, text(row, "host_id"), metadata),
    ...(nullableText(row, "runtime_offer_id")
      ? {
          runtime: publicRuntimeMetadata(metadata, {
            hostId: text(row, "host_id"),
            runtimeProfileId: text(row, "runtime_profile_id"),
            runtimeProfileRevisionId: text(row, "runtime_profile_revision_id"),
          }),
          runtimeOfferId: text(row, "runtime_offer_id"),
          runtimeProfileId: text(row, "runtime_profile_id"),
          runtimeProfileRevisionId: text(row, "runtime_profile_revision_id"),
        }
      : {}),
    model: model
      ? {
          source: model.source,
          ...(model.source === "custom_model"
            ? { modelId: model.modelId }
            : {}),
          ...(model.source === "explicit_binding"
            ? {
                modelBindingId: model.modelBindingId,
                provider: model.provider,
                modelId: model.modelId,
                ...(model.reasoning ? { reasoning: model.reasoning } : {}),
              }
            : {}),
        }
      : null,
  };
}
