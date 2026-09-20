import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/product-styles.ts";
import {
  AgentDetailHeader,
  AgentRemindersPane,
} from "../src/components/agent-directory-pane.tsx";
import { AgentCreateDialog } from "../src/components/agent-dialogs.tsx";
import { AgentMessageContext } from "../src/components/workspace-entity-context.tsx";
import { AgentUnavailablePanel } from "../src/components/agent-unavailable-panel.tsx";
import { MessageArticle } from "../src/components/conversation-panes.tsx";
import { AgentProfileFieldEditor } from "../src/components/agent-profile-field.tsx";
import type { RahClient } from "@rah-os/client-sdk";
import type { LocalRuntimeInventoryEntry } from "@rah-os/protocol";
import { AgentRuntimeDialog } from "../src/components/agent-runtime-dialog.tsx";
import type { ClientAgentGetResponse } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { AgentExecutionResetDialog } from "../src/components/agent-execution-reset-dialog.tsx";
import { RoomSidebar } from "../src/components/workspace-navigation.tsx";
import { SidebarPreferencesProvider } from "../src/components/sidebar-preferences.tsx";
import { DEFAULT_SIDEBAR_PREFERENCES } from "@rah-os/protocol";
const sidebarClient = {
  request: async () => ({ preferences: DEFAULT_SIDEBAR_PREFERENCES }),
} as unknown as RahClient;
const noop = () => {};
function Fixture() {
  const mode = new URLSearchParams(location.search).get("mode");
  const [sent, setSent] = useState(0);
  const [closed, setClosed] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<string>();
  const [environmentWrites, setEnvironmentWrites] = useState(0);
  if (closed) return <p>Fixture closed</p>;
  if (mode === "deleted-dm") {
    const agents = ["old", "new"].map((id) => ({
      agentId: id,
      participantId: id,
      displayName: "Same Agent",
      handle: id,
      state: id === "old" ? "tombstoned" : "enabled",
      runtimeAvailable: false,
      runtimeLabels: [],
      skillRefs: [],
    })) as WorkspaceAgentView[];
    return (
      <div
        className="rah-product-shell"
        style={{ display: "block", width: "100%" }}
      >
        <SidebarPreferencesProvider
          client={sidebarClient}
          workspaceId="fixture"
          enabled
          disclosureScope="deleted-dm-fixture"
          hostInstanceId="fixture"
        >
          <RoomSidebar
            activeRoomId={selectedRoom}
            agents={agents}
            canCreate={false}
            canMessage={false}
            contextControl={{
              onArchive: async () => {},
              onUnread: async () => {},
              onCloseConversation: noop,
              onCreate: noop,
              canCreate: false,
            }}
            currentHumanId="human"
            mobileOpen
            onActivity={noop}
            onCreate={noop}
            onSearch={noop}
            onOpenDirectRoom={async () => {
              throw new Error("Historical DM must select its existing Room");
            }}
            onSelect={setSelectedRoom}
            workspace={{
              workspaceId: "fixture",
              name: "Fixture",
              slug: "fixture",
              state: "active",
              createdAt: "2026-09-19T00:00:00Z",
            }}
            rooms={["old", "new"].map((id) => ({
              roomId: `dm-${id}`,
              workspaceId: "fixture",
              name: "Provider CLI",
              slug: `dm-${id}`,
              kind: "direct",
              createdAt: "2026-09-19T00:00:00Z",
              directParticipantIds: ["human", id],
            }))}
          />
        </SidebarPreferencesProvider>
        <output>{selectedRoom}</output>
      </div>
    );
  }
  if (mode === "deleted")
    return (
      <AgentMessageContext.Provider
        value={{
          client: {
            request: async (command: string) =>
              command === "agent.get"
                ? {
                    policy: {
                      modelIntent: {
                        exactBindingIds: ["fixture-model"],
                        reasoning: "low",
                      },
                    },
                  }
                : {
                    activities: [
                      {
                        serverSequence: 1,
                        observedAt: "2026-09-19T00:00:00Z",
                        entry: {
                          kind: "status",
                          activity: "offline",
                          detail: "Fixture activity",
                        },
                      },
                    ],
                  },
          } as unknown as RahClient,
          canManageAgents: true,
          onOpen: () => setDeletedOpen(true),
        }}
      >
        <div
          className={`app rah-product-shell${deletedOpen ? " rah-agent-peek-open" : ""}`}
          data-conversation-layout="single"
          data-profile-source="room"
          style={{
            display: "grid",
            minWidth: 0,
            width: "100%",
            height: "100dvh",
          }}
        >
          <div
            style={{
              display: "flex",
              visibility: deletedOpen ? "hidden" : "visible",
              gridColumn: 1,
              gridRow: 1,
            }}
          >
            <MessageArticle
              client={{} as RahClient}
              message={{
                messageId: "fixture",
                actorId: "deleted",
                author: "OpenCode provider fallback",
                body: "Historical reply",
                createdAt: "2026-09-19T00:00:00Z",
                roomSeq: 1,
              }}
              messageAgent={
                {
                  agentId: "deleted",
                  participantId: "deleted",
                  displayName: "Deleted Agent",
                  modelBindingId:
                    "local:opencode-cli/v1:provider/very-long-historical-model-name",
                  handle: "deleted",
                  state: "tombstoned",
                  runtimeAvailable: false,
                  runtimeLabels: [],
                  skillRefs: [],
                } as unknown as WorkspaceAgentView
              }
              onMention={() => setSent((n) => n + 1)}
            />
          </div>
          {deletedOpen && (
            <div
              className="rah-agent-peek rah-agent-directory-page rah-agent-runtime-page is-mobile-detail-open"
              style={{ display: "flex", flex: 1 }}
            >
              <AgentUnavailablePanel onClose={() => setDeletedOpen(false)} />
            </div>
          )}
          <output style={{ position: "absolute", bottom: 0 }}>{sent}</output>
        </div>
      </AgentMessageContext.Provider>
    );
  if (mode === "profile-fields")
    return (
      <div
        className="rah-product-shell"
        style={{ display: "block", padding: 20, minWidth: 0, width: "100%" }}
      >
        {(["displayName", "description"] as const).map((field) => (
          <AgentProfileFieldEditor
            key={field}
            agentId="fixture"
            revisionId="revision"
            field={field}
            value={
              field === "displayName" ? "Fixture Agent" : "Fixture description"
            }
            onSave={async () => {
              setSent((n) => n + 1);
            }}
          />
        ))}
        <output>{sent}</output>
      </div>
    );
  if (mode === "reset")
    return (
      <AgentExecutionResetDialog
        agentName="Fixture Agent"
        fullResetEnabled
        onClose={() => setClosed(true)}
        onConfirm={async () => {}}
      />
    );
  if (mode === "reminder")
    return (
      <div style={{ height: 500, display: "flex" }}>
        <AgentRemindersPane
          error={undefined}
          loading={false}
          onOpenMessage={noop}
          onRetry={noop}
          reminders={[]}
        />
      </div>
    );
  if (mode === "create")
    return (
      <AgentCreateDialog
        onRefreshModels={async () => {}}
        client={
          {
            request: async (
              command: string,
              input: {
                agentId: string;
                runtimeId?: string;
                environment?: Record<string, string>;
              },
            ) => {
              if (input.agentId !== "fixture-created")
                throw new Error("Wrong environment scope");
              if (command === "runtime.guide.update") {
                if (
                  input.runtimeId !== "claude" ||
                  Object.keys(input.environment ?? {}).length !== 1 ||
                  input.environment?.EXAMPLE_FLAG !== "yes"
                )
                  throw new Error("Lost launch settings");
                setEnvironmentWrites((n) => n + 1);
                if (environmentWrites === 0)
                  throw new Error("Fixture environment failure");
              }
              return { revision: 1, runtimes: [] };
            },
          } as unknown as RahClient
        }
        computerLabel="Fixture Mac (fixture.local)"
        runtimes={[
          {
            available: true,
            configured: true,
            cliId: "claude",
            displayName: "Claude Code",
            runtimeOfferId: "fixture-offer",
            toolAccessModes: ["full_access"],
            modelBindingDescriptors: [
              {
                modelBindingId: "sonnet",
                modelId: "sonnet",
                provider: "anthropic",
                supportedReasoning: ["low", "high"],
              },
            ],
          } as unknown as LocalRuntimeInventoryEntry,
        ]}
        onClose={() => setClosed(true)}
        onCreate={async (input) => {
          if (
            input.modelIntent.reasoning !== "high" ||
            input.modelIntent.exactBindingIds?.[0] !== "sonnet" ||
            JSON.stringify(input).includes("fixture-only-key")
          )
            throw new Error("Invalid creation payload");
          setSent((n) => n + 1);
          if (sent > 0) throw new Error("Duplicate fixture Agent");
          return "fixture-created";
        }}
      />
    );
  if (mode === "runtime")
    return (
      <AgentRuntimeDialog
        client={
          {
            request: async () => ({
              revision: 1,
              runtimes: [{ runtimeId: "claude", environment: {} }],
            }),
          } as unknown as RahClient
        }
        onRefreshModels={async () => {}}
        detail={
          {
            agent: {
              definition: { agentId: "fixture" },
              handle: "fixture",
              currentRevision: {},
            },
            policy: {
              required: { allowedOfferIds: ["fixture-opencode"] },
              modelIntent: { exactBindingIds: ["example/model-0"] },
            },
          } as ClientAgentGetResponse
        }
        runtimes={[
          {
            available: true,
            configured: true,
            cliId: "opencode",
            displayName: "OpenCode",
            runtimeOfferId: "fixture-opencode",
            toolAccessModes: ["full_access"],
            modelBindingDescriptors: Array.from({ length: 20 }, (_, i) => ({
              modelBindingId: `example/model-${i}`,
              modelId: `model-${i}`,
              provider: "example",
              displayName: `Friendly Model ${i}`,
              supportedReasoning: ["low", "high"],
            })),
          } as unknown as LocalRuntimeInventoryEntry,
        ]}
        onClose={() => setClosed(true)}
        onConfigure={async () => {}}
      />
    );
  return (
    <>
      <AgentDetailHeader
        agent={
          {
            displayName: "Fixture Agent",
            handle: "fixture",
            state: "enabled",
          } as WorkspaceAgentView
        }
        canMessage
        messagePending={false}
        onBack={noop}
        onManage={noop}
        onMessage={() => setSent(sent + 1)}
      />
      <output>{sent}</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
