/** These pages are source inputs only; importing a leaf must not ship their cloud owners. */
const forbidden = [
  "api/client.ts",
  "components/profile/ProfilePanel.tsx",
  "components/agent/AgentMcpTab.tsx",
  "components/agent/ChannelMembers.tsx",
  "components/layout/Sidebar.tsx",
  "components/layout/LeftRail.tsx",
];
export function assertOfficialRuntimeBoundary(ids: Iterable<string>) {
  for (const id of ids) {
    const file = id.replaceAll("\\", "/").split("?")[0];
    if (
      forbidden.some((path) =>
        file.endsWith("/frontends/raft/packages/web/src/" + path),
      )
    )
      throw new Error("Unexpected official runtime dependency: " + file);
  }
}
