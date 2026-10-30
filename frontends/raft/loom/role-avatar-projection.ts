import type { AgentCatalogEntry, RoleListResponse } from "@rah-os/protocol";
export type InstanceAvatarMap = Readonly<Record<string, string | undefined>>;
/** Current visual identity only. Frozen Role/Agent revisions remain execution facts. */
export function projectRoleAvatars(
  roles: RoleListResponse,
  agents: readonly AgentCatalogEntry[],
): Record<string, string | undefined> {
  const current = new Map(
    [...roles.roles, ...(roles.deletedRoles ?? [])].map((r) => [
      r.roleId,
      r.configuration.avatarKey,
    ]),
  );
  const result: Record<string, string | undefined> = Object.fromEntries(
    agents.map((a) => [
      a.definition.participantId,
      a.currentRevision.avatarKey,
    ]),
  );
  for (const instance of roles.instances)
    if (current.has(instance.roleId))
      result[instance.instanceId] = current.get(instance.roleId);
  return result;
}
