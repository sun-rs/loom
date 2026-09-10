import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/product-styles.ts";
import {
  AgentDetailHeader,
  AgentRemindersPane,
} from "../src/components/agent-directory-pane.tsx";
import { AgentCreateDialog } from "../src/components/agent-dialogs.tsx";
import { AgentRuntimeDialog } from "../src/components/agent-runtime-dialog.tsx";
import type { ClientAgentGetResponse } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { AgentExecutionResetDialog } from "../src/components/agent-execution-reset-dialog.tsx";
const noop = () => {};
function Fixture() {
  const mode = new URLSearchParams(location.search).get("mode");
  const [sent, setSent] = useState(0);
  const [closed, setClosed] = useState(false);
  if (closed) return <p>Fixture closed</p>;
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
        computerLabel="Fixture Mac (fixture.local)"
        runtimes={[]}
        onClose={() => setClosed(true)}
        onCreate={async () => {}}
      />
    );
  if (mode === "runtime")
    return (
      <AgentRuntimeDialog
        detail={
          {
            agent: { handle: "fixture", currentRevision: {} },
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
