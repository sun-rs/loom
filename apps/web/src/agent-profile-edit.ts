import type { ClientAgentProfileRequest } from "@rah-os/protocol";

export type AgentProfileEditInput = Pick<
  ClientAgentProfileRequest,
  "agentDefinitionId" | "expectedRevisionId" | "field" | "value"
>;
