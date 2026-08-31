import { createHash } from "node:crypto";
import { join } from "node:path";

import { RuntimeProfileRegistry } from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";

import type {
  LocalWorkbenchMetadata,
  LocalWorkbenchRuntimeSpec,
} from "./local-workbench-bootstrap.ts";

/** Bootstrap owns migration of its managed Offers, not the immutable Offer ledger. */
export function reconcileLocalWorkbenchRuntimeBindings(input: {
  humanAccessToken: string;
  metadata: LocalWorkbenchMetadata;
  registryDatabasePath: string;
  runtimeSpecs: readonly LocalWorkbenchRuntimeSpec[];
  stateDirectory: string;
}): Map<string, string> {
  const registry = new RuntimeProfileRegistry({
    databasePath: input.registryDatabasePath,
    hostId: input.metadata.hostId,
  });
  const activeIds = new Map<string, string>();
  const successors = new Map<string, string>();
  registry.initialize();
  try {
    for (const spec of input.runtimeSpecs) {
      const active = registry.getActiveRevision(spec.runtimeProfileId);
      if (!active)
        throw new Error(
          `No active local RuntimeProfile ${spec.runtimeProfileId}`,
        );
      const prefix = `local-workbench-offer-${spec.cliId}`;
      const activeId = `${prefix}:${active.runtimeProfileRevisionId}`;
      activeIds.set(spec.cliId, activeId);
      // Exact known identities only; never match arbitrary remote Offers by prefix.
      successors.set(prefix, activeId);
      for (const revision of registry.listRevisions(spec.runtimeProfileId)) {
        successors.set(
          `${prefix}:${revision.runtimeProfileRevisionId}`,
          activeId,
        );
      }
    }
  } finally {
    registry.close();
  }

  const kernel = new RoomKernel({
    databasePath: join(input.stateDirectory, "room.db"),
  });
  kernel.initialize();
  try {
    const actor = kernel.authenticateHumanAccessToken(input.humanAccessToken);
    const controlRoomId = input.metadata.controlRoomId;
    const latestSeq = () =>
      kernel.sync(actor, {
        consumerId: "local-workbench-runtime-upgrade",
        roomId: controlRoomId,
      }).latestRoomSeq;
    for (const entry of kernel.listAgentCatalog(actor, { controlRoomId })) {
      if (entry.definition.state === "tombstoned") continue;
      const previous = kernel.getExecutionPolicyRevision(
        entry.currentRevision.executionPolicyRevisionId,
      );
      const allowedOfferIds = previous.required.allowedOfferIds?.map(
        (id) => successors.get(id) ?? id,
      );
      const preferred = previous.preferred.map((preference) =>
        preference.criterion === "runtime_offer"
          ? {
              ...preference,
              targetId:
                successors.get(preference.targetId) ?? preference.targetId,
            }
          : preference,
      );
      if (
        JSON.stringify([allowedOfferIds, preferred]) ===
        JSON.stringify([previous.required.allowedOfferIds, previous.preferred])
      )
        continue;
      const required = {
        ...previous.required,
        ...(allowedOfferIds === undefined
          ? {}
          : { allowedOfferIds: [...new Set(allowedOfferIds)] }),
      };
      const migrationKey = createHash("sha256")
        .update(
          JSON.stringify([
            previous.executionPolicyRevisionId,
            required,
            preferred,
          ]),
        )
        .digest("hex");
      // The old policy/Agent revisions, placements and RunAttempts remain frozen.
      // Stable keys recover even if a process exits between these two transactions.
      const policy = kernel.reviseExecutionPolicy(actor, {
        ...previous,
        required,
        preferred,
        basedOnRoomSeq: latestSeq(),
        idempotencyKey: `local-offer-policy:${migrationKey}`,
      }).policy;
      kernel.reviseAgentDefinition(actor, {
        ...entry.currentRevision,
        executionPolicyRevisionId: policy.executionPolicyRevisionId,
        basedOnRoomSeq: latestSeq(),
        idempotencyKey: `local-offer-agent:${entry.currentRevision.agentDefinitionRevisionId}:${migrationKey}`,
      });
    }
  } finally {
    kernel.close();
  }
  return activeIds;
}
