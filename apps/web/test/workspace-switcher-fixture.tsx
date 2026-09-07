import { useMemo, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Room, Workspace } from "@rah-os/protocol";
import { WorkspaceIdentity } from "../src/components/workspace-identity.tsx";

const WORKSPACES: Workspace[] = [
  {
    workspaceId: "workspace-alpha",
    controlRoomId: "control-alpha",
    name: "Alpha Workspace",
    slug: "alpha",
    createdAt: "2026-09-06T00:00:00.000Z",
  },
  {
    workspaceId: "workspace-beta",
    controlRoomId: "control-beta",
    name: "Beta Workspace",
    slug: "beta",
    createdAt: "2026-09-06T00:00:01.000Z",
  },
  {
    workspaceId: "workspace-gamma",
    controlRoomId: "control-gamma",
    name: "A deliberately very long Workspace name that must stay inside the anchored switcher",
    slug: "gamma-with-a-deliberately-long-slug",
    createdAt: "2026-09-06T00:00:02.000Z",
  },
];

const ROOMS: Room[] = WORKSPACES.flatMap((workspace, index) => [
  {
    roomId: `room-${workspace.slug}`,
    workspaceId: workspace.workspaceId,
    name: `${workspace.name} Council`,
    slug: `${workspace.slug}-council`,
    kind: "channel",
    visibility: "private",
    state: "active",
    createdAt: `2026-09-06T00:01:0${index}.000Z`,
  },
]);

// Bounded component fixture. It never connects to a daemon or Provider.
export function WorkspaceSwitcherFixture({ mobile }: { mobile: boolean }) {
  const [selected, setSelected] = useState(WORKSPACES[0]!);
  const [remembered, setRemembered] = useState("");
  const [navigationMode, setNavigationMode] = useState("");
  const client = useMemo(
    () =>
      ({
        request: async (operation: string) => {
          if (operation === "room.sync") return { latestRoomSeq: 7 };
          if (operation === "workspace.list") return { workspaces: WORKSPACES };
          throw new Error(`Unexpected fixture operation: ${operation}`);
        },
      }) as unknown as RahClient,
    [],
  );
  return (
    <main
      className="app rah-product-shell"
      style={{ minHeight: "100vh", minWidth: 0, padding: mobile ? 8 : 20 }}
    >
      <section
        data-workspace-switcher-fixture
        style={{
          display: "flex",
          position: "relative",
          width: mobile ? "100%" : 64,
          height: 64,
        }}
      >
        <WorkspaceIdentity
          computerName="Fixture Computer"
          workspace={selected}
          workspaces={WORKSPACES}
          rooms={ROOMS}
          client={client}
          canManage
          principalId="fixture-human"
          onUpdated={setSelected}
          onSelect={(workspace, location, mode) => {
            setSelected(workspace);
            setRemembered(location ?? "");
            setNavigationMode(mode);
          }}
          mobile={mobile}
        />
      </section>
      <button type="button" data-workspace-outside>
        Outside target
      </button>
      <output
        data-workspace-selection
        data-selected={selected.workspaceId}
        data-remembered={remembered}
        data-navigation-mode={navigationMode}
      />
    </main>
  );
}
