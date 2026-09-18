import { createRoot } from "react-dom/client";
import { useState } from "react";
import type { Room } from "@rah-os/protocol";
import type { RahClient } from "@rah-os/client-sdk";
import { SettingsSurface } from "../src/components/settings-surface.tsx";
import { AgentChatPane } from "../src/components/agent-directory-pane.tsx";
import "../src/agent-directory.css";
import "../src/product-styles.ts";
const longLaunch = new URLSearchParams(location.search).has("longLaunch");
let revision = 0;
const enabled = new Set(["codex", "claude"]);
const client = {
  async request(
    command: string,
    input: { runtimeId?: string; enabled?: boolean; expectedRevision?: number },
  ) {
    if (command === "runtime.guide.update") {
      if (
        Object.keys(input).some(
          (key) => !["runtimeId", "enabled", "expectedRevision"].includes(key),
        )
      )
        throw new Error("Global launch writes forbidden");
      if (
        input.expectedRevision !== revision ||
        !["codex", "claude"].includes(input.runtimeId ?? "")
      )
        throw new Error("Invalid Guide update");
      if (input.enabled) enabled.add(input.runtimeId!);
      else enabled.delete(input.runtimeId!);
      revision++;
    } else if (command !== "runtime.guide.read")
      throw new Error("Unexpected command");
    return {
      revision,
      runtimes: ["codex", "claude", "kimi", "opencode"].map((runtimeId) => ({
        runtimeId,
        enabled: enabled.has(runtimeId),
        supported: ["codex", "claude"].includes(runtimeId),
        detail: "Fixture",
        additionalArgs: [],
        environment: {},
        inheritedArgs: [],
        inheritedEnvironment: {},
        managedLaunch: {
          args: [],
          environment:
            runtimeId === "claude"
              ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }
              : {},
        },
        defaultArgs:
          runtimeId === "codex"
            ? [
                "app-server",
                ...(longLaunch
                  ? Array.from(
                      { length: 20 },
                      (_, i) => `--fixture-option-${i}=${"x".repeat(80)}`,
                    )
                  : []),
              ]
            : [],
        requiredArgs: [],
        effectiveArgs: [],
        overrideArgs: null,
      })),
    };
  },
} as unknown as RahClient;
function Fixture() {
  const [archivedRooms, setArchivedRooms] = useState<Room[]>([
    {
      roomId: "archive-fixture",
      workspaceId: "fixture",
      kind: "channel",
      name: "Archived fixture",
      slug: "archived-fixture",
      archivedAt: "2026-09-15T08:06:00Z",
      visibility: "public",
    } as Room,
  ]);
  const [attempts, setAttempts] = useState(0);
  if (new URLSearchParams(location.search).has("agentChat"))
    return (
      <AgentChatPane
        directError={undefined}
        error={undefined}
        loading={false}
        onOpenRoom={(id) => {
          document.body.dataset.openedRoom = id;
        }}
        rooms={[
          {
            ...archivedRooms[0]!,
            roomId: "public",
            name: "Public fixture",
            visibility: "public",
          },
          {
            ...archivedRooms[0]!,
            roomId: "private",
            name: "Private fixture",
            visibility: "private",
          },
        ]}
      />
    );
  return (
    <main
      style={{
        height: "100vh",
        display: "flex",
        gridTemplateColumns: "0 minmax(0, 1fr) 0",
        gridTemplateRows: "minmax(0, 1fr)",
      }}
    >
      <SettingsSurface
        client={client}
        agents={[]}
        canManageWorkspace={true}
        archivedRooms={archivedRooms}
        onOpenRoom={(id) => {
          document.body.dataset.openedRoom = id;
        }}
        onUnarchiveRoom={async (room) => {
          setAttempts(attempts + 1);
          if (attempts === 0) throw new Error("Fixture denied");
          setArchivedRooms((rooms) =>
            rooms.filter((item) => item.roomId !== room.roomId),
          );
        }}
        onSystemChannelUpdated={() => {}}
        currentPrincipal={undefined}
        workspace={undefined}
        onWorkspaceUpdated={() => {}}
        onPrincipalUpdated={() => {}}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
