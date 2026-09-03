import {
  ClientAgentProfileRequestSchema,
  type ClientAgentProfileRequest,
} from "@rah-os/protocol";
export type AgentProfileEditInput = Pick<
  ClientAgentProfileRequest,
  | "agentDefinitionId"
  | "avatarUploadIntentId"
  | "expectedRevisionId"
  | "field"
  | "value"
>;
export type AgentProfileField = ClientAgentProfileRequest["field"];

export function validProfileField(
  field: AgentProfileField,
  value: string,
): boolean {
  return ClientAgentProfileRequestSchema.safeParse({
    action: "update_profile",
    agentDefinitionId: "validation",
    expectedRevisionId: "validation",
    basedOnRoomSeq: 0,
    idempotencyKey: "validation",
    field,
    value,
  }).success;
}
export function profileEditorKeyAction(
  field: AgentProfileField,
  key: string,
  composing: boolean,
  pending: boolean,
): "save" | "cancel" | undefined {
  if (composing || pending) return;
  if (key === "Escape") return "cancel";
  if (key === "Enter" && field === "displayName") return "save";
}
