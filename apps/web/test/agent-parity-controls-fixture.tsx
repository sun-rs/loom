import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/product-styles.ts";
import {
  AgentDetailHeader,
  AgentRemindersPane,
} from "../src/components/agent-directory-pane.tsx";
import { AgentCreateDialog } from "../src/components/agent-dialogs.tsx";
import { AgentProfileFieldEditor } from "../src/components/agent-profile-field.tsx";
import type { RahClient } from "@rah-os/client-sdk";
import type { LocalRuntimeInventoryEntry } from "@rah-os/protocol";
import { AgentRuntimeDialog } from "../src/components/agent-runtime-dialog.tsx";
import type { ClientAgentGetResponse } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { AgentExecutionResetDialog } from "../src/components/agent-execution-reset-dialog.tsx";
const noop = () => {};
function Fixture() {
  const mode = new URLSearchParams(location.search).get("mode");
  const [sent, setSent] = useState(0);
  const [closed, setClosed] = useState(false);
  const [environmentWrites, setEnvironmentWrites] = useState(0);
  if (closed) return <p>Fixture closed</p>;
  if (mode === "profile-fields")
    return (
      <div
        className="rah-product-shell"
        style={{ display: "block", padding: 20, minWidth: 0, width: "100%" }}
      >
        {(["displayName", "description"] as const).map((field) => (
          <AgentProfileFieldEditor
            key={field}
            agentDefinitionId="fixture"
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
                agentDefinitionId: string;
                runtimeId?: string;
                environment?: Record<string, string>;
              },
            ) => {
              if (input.agentDefinitionId !== "fixture-created")
                throw new Error("Wrong environment scope");
              if (command === "runtime.guide.update") {
                if (
                  input.runtimeId !== "claude" ||
                  input.environment?.ANTHROPIC_API_KEY !== "fixture-only-key" ||
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
              definition: { agentDefinitionId: "fixture" },
              handle: "fixture",
              currentRevision: {},
            },
            policy: { required: { allowedOfferIds: [] }, modelIntent: {} },
          } as ClientAgentGetResponse
        }
        runtimes={[]}
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
