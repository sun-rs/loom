import { createRoot } from "react-dom/client";
import type { RahClient } from "@rah-os/client-sdk";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { MessageArticle } from "../src/components/conversation-panes.tsx";
import { ChatDateDivider } from "../src/components/chat-message-time.tsx";
import "../src/product-styles.ts";

const client = {
  request: async () => {
    throw Error("Unexpected fixture request");
  },
} as unknown as RahClient;
const agent: WorkspaceAgentView = {
  agentDefinitionId: "fixture-agent",
  participantId: "fixture-agent",
  createdAt: "2026-09-01T00:00:00Z",
  createdBy: "fixture-human",
  displayName: "Fixture Agent",
  handle: "fixture-agent",
  executionPolicyRevisionId: "fixture-policy",
  role: "Assistant",
  runtimeAvailable: false,
  runtimeLabels: [],
  skillRefs: [],
  state: "enabled",
  modelBindingId: "fixture/model",
};
document.documentElement.dataset.rahAgentModelName = "true";
const rows = [
  { id: "earlier", at: "2026-09-02T22:39:00+08:00", agent: true },
  { id: "yesterday", at: "2026-09-13T13:07:00+08:00", agent: true },
  { id: "human", at: "2026-09-14T12:33:00+08:00", agent: false },
  { id: "today", at: "2026-09-14T12:34:00+08:00", agent: true },
];
createRoot(document.getElementById("root")!).render(
  <main className="chan-pane" style={{ padding: 16 }}>
    <p>Fixture · shared production message timestamps · no provider calls</p>
    {rows.map((row) => (
      <section key={row.id} data-fixture-date={row.id}>
        <ChatDateDivider createdAt={row.at} />
        <MessageArticle
          client={client}
          message={{
            messageId: row.id,
            actorId: row.agent ? agent.participantId : "fixture-human",
            author: row.agent ? "Fixture Agent" : "Fixture Human",
            body: "Calendar rollover fixture message",
            createdAt: row.at,
            roomSeq: 1,
          }}
          {...(row.agent ? { messageAgent: agent } : {})}
        />
      </section>
    ))}
    <textarea aria-label="保留草稿" placeholder="Fixture draft" />
  </main>,
);
