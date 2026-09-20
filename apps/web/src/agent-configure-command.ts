import type { RahClient } from "@rah-os/client-sdk";
import {
  runRoomMutationAtLatest,
  type RoomMutationSequenceSession,
} from "@rah-os/client-core";
import type {
  ClientAgentGetResponse,
  ClientAgentManageRequest,
} from "@rah-os/protocol";

type Configure = Extract<ClientAgentManageRequest, { action: "configure" }>;
export type AgentConfigurationInput = Omit<
  Configure,
  "action" | "agentId" | "basedOnRoomSeq" | "idempotencyKey"
>;

/** One editor command over the existing Room barrier and canonical management owner. */
export function createAgentConfigureCommand(options: {
  client: RahClient;
  detail: ClientAgentGetResponse;
  session: RoomMutationSequenceSession;
  createKey: () => string;
}) {
  let request: Configure | undefined;
  let draft: string | undefined;
  let busy = false;
  return async (input: AgentConfigurationInput) => {
    const encoded = JSON.stringify(input);
    if (busy) throw new Error("正在保存 Agent 配置");
    if (request && draft !== encoded)
      throw new Error(
        "上次配置结果尚未确认。请重试原配置，或关闭并重新读取后编辑。",
      );
    busy = true;
    try {
      return await runRoomMutationAtLatest({
        session: options.session,
        mutate: async (basedOnRoomSeq) => {
          if (!request) {
            const latest = await options.client.request("agent.get", {
              agentId: options.detail.agent.definition.agentId,
            });
            if (
              latest.agent.currentRevision.revision !==
              options.detail.agent.currentRevision.revision
            )
              throw new Error(
                "Agent 配置已在其他页面修改。请关闭并重新打开编辑窗口后再保存，本次未覆盖。",
              );
            request = structuredClone({
              ...input,
              action: "configure" as const,
              agentId: options.detail.agent.definition.agentId,
              basedOnRoomSeq,
              idempotencyKey: options.createKey(),
            });
            draft = encoded;
          }
          try {
            return await options.client.request("agent.manage", request);
          } catch (error) {
            // Only a canonical stale rejection proves this request was not accepted.
            // Unknown/network failures retain the exact wire body for receipt replay.
            if (
              error &&
              typeof error === "object" &&
              "status" in error &&
              error.status === 409 &&
              "code" in error &&
              error.code === "stale_context"
            )
              request = undefined;
            throw error;
          }
        },
      });
    } finally {
      busy = false;
    }
  };
}
