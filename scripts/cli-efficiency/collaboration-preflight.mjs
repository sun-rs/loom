import assert from "node:assert/strict";
// Resolve the whole team before any channel/member mutation. An empty catalog
// is a preparation failure, not a reason to stop and then broadcast-resume a room.
export function resolveCollaborationBindings(runtimes, members) {
  return Object.fromEntries(
    Object.entries(members).map(([provider, member]) => {
      const matches = runtimes.filter(
        (r) =>
          r.kind === provider + "-cli/v1" ||
          r.runtimeProfileId === "local-workbench-profile-" + provider,
      );
      assert.equal(matches.length, 1, provider + ": expected one runtime");
      const runtime = matches[0];
      assert(runtime.runtimeOfferId, provider + ": no offer");
      const binding = runtime.modelBindingDescriptors?.find(
        (b) => b.modelId === member.model,
      );
      assert(
        binding?.supportedReasoning.includes(member.effort ?? "low"),
        provider + ": exact model/effort unavailable: " + member.model,
      );
      return [provider, { runtime, binding }];
    }),
  );
}
