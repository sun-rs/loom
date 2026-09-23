import {
  InstanceSessionBindingSchema,
  type InstanceSessionBinding,
} from "@rah-os/protocol";

/**
 * Pure transition rules, not a persistence owner or an authorization gate.
 * Future command handlers must read current from the Kernel transaction,
 * authenticate the caller, fence active execution, enforce native-ID uniqueness
 * and atomically persist the transition/event. No production handler calls
 * these rules yet; passing a caller-supplied current is not execution fencing.
 */
export function requireInstanceSessionBinding(
  uncheckedCurrent: unknown,
  uncheckedExpected: unknown,
): InstanceSessionBinding {
  const current = InstanceSessionBindingSchema.parse(uncheckedCurrent);
  const expected = InstanceSessionBindingSchema.parse(uncheckedExpected);
  for (const key of Object.keys(current) as (keyof InstanceSessionBinding)[]) {
    if (current[key] !== expected[key]) {
      throw new Error(`Instance session binding conflict: ${key}`);
    }
  }
  return current;
}

export function replaceInstanceSessionBinding(
  current: unknown,
  expected: unknown,
  providerSessionId: string,
): InstanceSessionBinding {
  const binding = requireInstanceSessionBinding(current, expected);
  if (providerSessionId === binding.providerSessionId) {
    throw new Error("Replacement requires a different native session");
  }
  if (binding.bindingEpoch === Number.MAX_SAFE_INTEGER) {
    throw new Error("Instance session binding epoch exhausted");
  }
  return InstanceSessionBindingSchema.parse({
    ...binding,
    providerSessionId,
    bindingEpoch: binding.bindingEpoch + 1,
  });
}

export function forkInstanceSessionBinding(
  current: unknown,
  expected: unknown,
  instanceId: string,
  providerSessionId: string,
): InstanceSessionBinding {
  const binding = requireInstanceSessionBinding(current, expected);
  if (
    instanceId === binding.instanceId ||
    providerSessionId === binding.providerSessionId
  ) {
    throw new Error("Fork requires a different instance and native session");
  }
  return InstanceSessionBindingSchema.parse({
    ...binding,
    instanceId,
    providerSessionId,
    bindingEpoch: 1,
  });
}
