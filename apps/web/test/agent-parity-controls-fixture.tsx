import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/product-styles.ts";
import { AgentDetailHeader } from "../src/components/agent-directory-pane.tsx";
import { AgentCreateDialog } from "../src/components/agent-dialogs.tsx";
import { AgentRuntimeDialog } from "../src/components/agent-runtime-dialog.tsx";
import type { ClientAgentGetResponse } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
const noop = () => {};
function Fixture() {
  const mode = new URLSearchParams(location.search).get("mode");
  const [sent, setSent] = useState(0);
  const [closed, setClosed] = useState(false);
  if (closed) return <p>Fixture closed</p>;
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
