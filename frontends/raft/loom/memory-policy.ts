import type { RahClient } from "@rah-os/client-sdk";
import type {
  MemoryPolicy,
  ClientMemoryPolicyUpdateRequest,
  MemoryPolicyUpdateResponse,
} from "@rah-os/protocol";
import {
  WriteIntentSlot,
  type IntentOutcome,
} from "@rah-os/client-core/write-intent";
export function policyPatch(base: MemoryPolicy, next: MemoryPolicy) {
  const patch: Omit<ClientMemoryPolicyUpdateRequest, "idempotencyKey"> = {
    channelId: base.channelId,
    expectedRevision: base.revision,
  };
  if (next.readDefault !== base.readDefault)
    patch.readDefault = next.readDefault;
  if (next.writeDefault !== base.writeDefault)
    patch.writeDefault = next.writeDefault;
  const overrides = next.overrides.filter((row) => {
    const old = base.overrides.find((v) => v.instanceId === row.instanceId);
    return (
      row.read !== (old?.read ?? null) || row.write !== (old?.write ?? null)
    );
  });
  if (overrides.length) patch.overrides = overrides;
  return patch.readDefault === undefined &&
    patch.writeDefault === undefined &&
    !overrides.length
    ? null
    : patch;
}
export class MemoryPolicyClient {
  readonly client: RahClient;
  readonly writes = new WriteIntentSlot();
  constructor(client: RahClient) {
    this.client = client;
  }
  save(
    base: MemoryPolicy,
    next: MemoryPolicy,
    onSettled: (outcome: IntentOutcome<MemoryPolicyUpdateResponse>) => void,
  ) {
    const payload = policyPatch(base, next);
    if (!payload) return Promise.resolve();
    return this.writes.submitRevisioned({
      action: "memory-policy",
      payload,
      send: (value, idempotencyKey) =>
        this.client.request("memory.policy.update", {
          ...value,
          idempotencyKey,
        }),
      onSettled,
    });
  }
}
