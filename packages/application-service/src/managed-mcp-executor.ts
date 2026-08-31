import type {
  ManagedMcpCallResult,
  ManagedMcpToolDefinition,
} from "@rah-os/protocol";

export type ManagedMcpExecutorDescriptor = {
  executorRef: string;
  transportKind: "streamable-http";
};

export type ManagedMcpAdministrationPort = {
  discover: (
    executorRef: string,
    options: { signal: AbortSignal },
  ) => Promise<ManagedMcpToolDefinition[]>;
  listExecutors: () => ManagedMcpExecutorDescriptor[];
};

export type ManagedMcpExecutorCall = {
  arguments: Record<string, unknown>;
  assignmentVersion: number;
  configVersion: number;
  executorRef: string;
  managedMcpCallId: string;
  mcpServerId: string;
  participantId: string;
  roomId: string;
  runAttemptId: string;
  toolName: string;
};

export type ManagedMcpExecutorPort = {
  call: (
    input: ManagedMcpExecutorCall,
    options: { signal: AbortSignal },
  ) => Promise<ManagedMcpCallResult>;
};
