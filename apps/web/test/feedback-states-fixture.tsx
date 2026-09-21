import { createRoot } from "react-dom/client";
import { AttachmentComments } from "../src/components/attachment-comments.tsx";
import { AgentProfileFieldEditor } from "../src/components/agent-profile-field.tsx";
import { WorkbenchServiceRestart } from "../src/components/workbench-service-restart.tsx";
import { AgentWorkspaceBrowser } from "../src/components/agent-workspace-browser.tsx";
import { jumpToAttachmentAnchor } from "../src/attachment-comment-anchors.ts";
import type { RahClient } from "@rah-os/client-sdk";
import "../src/product-styles.ts";
const mode = new URLSearchParams(location.search).get("mode");
const client = {
  request: async (op: string) => {
    if (op === "file.comments")
      return {
        roomId: "fixture-room",
        viewer: { canComment: true },
        comments: [
          {
            id: "fixture-comment",
            senderType: "human",
            senderId: "fixture-human",
            senderName: "测试用户",
            createdAt: "2026-09-21T02:00:00Z",
            content: "请查看这段内容。",
            anchor: { type: "lines", data: { start: 12 } },
          },
        ],
      };
    if (op === "room.member.list") return { memberships: [] };
    if (op === "agent.workspace.list")
      return { rootPath: "/测试工作区", entries: [] };
    throw Error("评论发送失败，请重试（隔离测试）");
  },
} as unknown as RahClient;
createRoot(document.getElementById("root")!).render(
  <main style={{ margin: 24, width: 740, background: "white" }}>
    {mode === "profile" ? (
      <AgentProfileFieldEditor
        agentId="fixture-agent"
        revisionId="fixture-revision"
        field="displayName"
        value="测试 Agent"
        onSave={async () => {
          throw Error("保存失败，草稿已保留（隔离测试）");
        }}
      />
    ) : mode === "restart" ? (
      <WorkbenchServiceRestart />
    ) : mode === "copy" ? (
      <AgentWorkspaceBrowser client={client} agentId="fixture-agent" />
    ) : (
      <div style={{ display: "flex", height: 440, border: "2px solid black" }}>
        <div id="preview" style={{ flex: 1, padding: 20 }}>
          <h3>测试附件.txt</h3>
          <pre data-anchor-line="12">12 评论关联的正文位置</pre>
        </div>
        <AttachmentComments
          client={client}
          attachmentId="fixture-file"
          filename="测试附件.txt"
          kind="text"
          open
          pendingAnchor={undefined}
          onClearAnchor={() => {}}
          onToggle={() => {}}
          onJump={(anchor) =>
            mode === "failed"
              ? false
              : jumpToAttachmentAnchor(
                  document.getElementById("preview")!,
                  anchor,
                  "text",
                )
          }
        />
      </div>
    )}
  </main>,
);
