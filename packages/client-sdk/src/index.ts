import {
  ClientAgentActivityListRequestSchema,
  ClientAgentActivityListResponseSchema,
  ClientAgentTrajectoryListRequestSchema,
  ClientAgentPresenceListRequestSchema,
  ClientAgentPresenceListResponseSchema,
  ClientAgentRemindersListRequestSchema,
  ClientAgentRemindersListResponseSchema,
  type ClientAgentPresenceListRequest,
  type ClientAgentPresenceListResponse,
  type ClientAgentRemindersListRequest,
  type ClientAgentRemindersListResponse,
  ClientAgentTrajectoryListResponseSchema,
  ClientAcknowledgeRequestSchema,
  ClientAcknowledgeResponseSchema,
  ClientAgentOnboardRequestSchema,
  ClientAgentRoomsListRequestSchema,
  ClientAgentRoomsListResponseSchema,
  ClientAgentManageRequestSchema,
  ClientAgentManageResponseSchema,
  ClientAgentGetRequestSchema,
  ClientAgentGetResponseSchema,
  ClientAgentExecutionResetRequestSchema,
  ClientAgentExecutionResetResponseSchema,
  ClientAgentMemoryGetRequestSchema,
  ClientAgentMemoryConfigGetRequestSchema,
  ClientAgentMemoryConfigPatchRequestSchema,
  ClientAgentMemoryConfigResponseSchema,
  type ClientAgentMemoryConfigGetRequest,
  type ClientAgentMemoryConfigPatchRequest,
  type ClientAgentMemoryConfigResponse,
  ClientAgentMemoryGetResponseSchema,
  ClientAgentMemoryReadRequestSchema,
  ClientAgentMemoryReadResponseSchema,
  ClientAgentMemoryResetRequestSchema,
  ClientAgentMemoryResetResponseSchema,
  ClientAgentProvisionRequestSchema,
  ClientAgentProvisionResponseSchema,
  ClientAgentsListRequestSchema,
  ClientAgentsListResponseSchema,
  ClientHealthResponseSchema,
  ClientInputRequestsListRequestSchema,
  ClientInputRequestsListResponseSchema,
  ClientMessageMutationResponseSchema,
  ClientMessageForwardRequestSchema,
  ClientMessageForwardResponseSchema,
  ClientMessageForwardTargetsRequestSchema,
  ClientMessageForwardTargetsResponseSchema,
  ClientMessagePostRequestSchema,
  ClientMessagesListRequestSchema,
  ClientMessagesListResponseSchema,
  ClientManagedMcpAssignmentCreateRequestSchema,
  ClientManagedMcpAssignmentMutationResponseSchema,
  ClientManagedMcpAssignmentReviseRequestSchema,
  ClientManagedMcpAssignmentsListRequestSchema,
  ClientManagedMcpAssignmentsListResponseSchema,
  ClientManagedMcpAssignmentStateRequestSchema,
  ClientManagedMcpExecutorDiscoverRequestSchema,
  ClientManagedMcpExecutorDiscoverResponseSchema,
  ClientManagedMcpExecutorsListRequestSchema,
  ClientManagedMcpExecutorsListResponseSchema,
  ClientManagedMcpServerCreateRequestSchema,
  ClientManagedMcpServerMutationResponseSchema,
  ClientManagedMcpServerReviseRequestSchema,
  ClientManagedMcpServersListRequestSchema,
  ClientManagedMcpServersListResponseSchema,
  ClientManagedMcpServerStateRequestSchema,
  ClientManagedMcpUsageListRequestSchema,
  ClientManagedMcpUsageListResponseSchema,
  ClientPrincipalMeRequestSchema,
  ClientPrincipalMeResponseSchema,
  ClientPrincipalUpdateRequestSchema,
  ClientPrincipalUpdateResponseSchema,
  ClientDirectRoomOpenRequestSchema,
  ClientDirectRoomOpenResponseSchema,
  ClientRoomSyncRequestSchema,
  ClientRoomSyncResponseSchema,
  ClientRoomArchiveRequestSchema,
  ClientRoomCreateRequestSchema,
  ClientRoomDeleteRequestSchema,
  ClientRoomDeleteResponseSchema,
  ClientRoomLeaveRequestSchema,
  ClientRoomAgentSosResponseSchema,
  ClientRoomAgentSosResumeRequestSchema,
  ClientRoomAgentSosStopRequestSchema,
  ClientRoomUnarchiveRequestSchema,
  ClientRoomUpdateRequestSchema,
  ClientRoomAgentActivityListRequestSchema,
  ClientRoomAgentActivityListResponseSchema,
  ClientRoomMemberAddRequestSchema,
  ClientRoomMemberMutationResponseSchema,
  ClientRoomMemberRemoveRequestSchema,
  ClientRoomMemberRemoveResponseSchema,
  ClientRoomMemberRoleRequestSchema,
  ClientRoomMembersListRequestSchema,
  ClientRoomMembersListResponseSchema,
  ClientRoomMutationResponseSchema,
  ClientRoomsListRequestSchema,
  ClientRoomsListResponseSchema,
  ClientTaskAttentionMutationResponseSchema,
  ClientTaskAssignRequestSchema,
  ClientTaskCancelRequestSchema,
  ClientTaskReopenRequestSchema,
  ClientTaskWorkflowUpdateRequestSchema,
  ClientTaskCompleteRequestSchema,
  ClientTaskConvertRequestSchema,
  ClientTaskCreateRequestSchema,
  ClientTaskMutationResponseSchema,
  ClientTaskReassignRequestSchema,
  ClientTaskReassignmentResponseSchema,
  ClientTaskUnassignRequestSchema,
  ClientTasksListRequestSchema,
  ClientTasksListResponseSchema,
  ClientTaskReviewEvidenceListRequestSchema,
  ClientTaskReviewEvidenceListResponseSchema,
  ClientTaskUnblockRequestSchema,
  ClientThreadCreateRequestSchema,
  ClientThreadCreateResponseSchema,
  ClientThreadReplyRequestSchema,
  ClientThreadsListRequestSchema,
  ClientThreadsListResponseSchema,
  ClientWorkspacesListRequestSchema,
  ClientWorkspacesListResponseSchema,
  ClientComputerProfileUpdateRequestSchema,
  ClientComputerProfileUpdateResponseSchema,
  ClientWorkspaceCreateRequestSchema,
  ClientWorkspaceUpdateRequestSchema,
  ClientWorkspaceMutationResponseSchema,
  ClientWorkspaceMemberGraphRequestSchema,
  ClientWorkspaceMemberGraphResponseSchema,
  InputRequestResolveRequestSchema,
  InputRequestResolveResponseSchema,
  LocalRuntimeInventoryRequestSchema,
  LocalRuntimeInventoryResponseSchema,
  type ClientAcknowledgeRequest,
  type ClientAcknowledgeResponse,
  type ClientAgentActivityListRequest,
  type ClientAgentActivityListResponse,
  type ClientAgentTrajectoryListRequest,
  type ClientAgentTrajectoryListResponse,
  type ClientAgentOnboardRequest,
  type ClientAgentRoomsListRequest,
  type ClientAgentRoomsListResponse,
  type ClientAgentManageRequest,
  type ClientAgentManageResponse,
  type ClientAgentGetRequest,
  type ClientAgentGetResponse,
  type ClientAgentExecutionResetRequest,
  type ClientAgentExecutionResetResponse,
  type ClientAgentMemoryGetRequest,
  type ClientAgentMemoryGetResponse,
  type ClientAgentMemoryReadRequest,
  type ClientAgentMemoryReadResponse,
  type ClientAgentMemoryResetRequest,
  type ClientAgentMemoryResetResponse,
  type ClientAgentProvisionRequest,
  type ClientAgentProvisionResponse,
  type ClientAgentsListRequest,
  type ClientAgentsListResponse,
  type ClientHealthResponse,
  type ClientInputRequestsListRequest,
  type ClientInputRequestsListResponse,
  type ClientMessageMutationResponse,
  type ClientMessageForwardRequest,
  type ClientMessageForwardResponse,
  type ClientMessageForwardTargetsRequest,
  type ClientMessageForwardTargetsResponse,
  type ClientMessagePostRequest,
  type ClientMessagesListRequest,
  type ClientMessagesListResponse,
  type ClientManagedMcpAssignmentCreateRequest,
  type ClientManagedMcpAssignmentMutationResponse,
  type ClientManagedMcpAssignmentReviseRequest,
  type ClientManagedMcpAssignmentsListRequest,
  type ClientManagedMcpAssignmentsListResponse,
  type ClientManagedMcpAssignmentStateRequest,
  type ClientManagedMcpExecutorDiscoverRequest,
  type ClientManagedMcpExecutorDiscoverResponse,
  type ClientManagedMcpExecutorsListRequest,
  type ClientManagedMcpExecutorsListResponse,
  type ClientManagedMcpServerCreateRequest,
  type ClientManagedMcpServerMutationResponse,
  type ClientManagedMcpServerReviseRequest,
  type ClientManagedMcpServersListRequest,
  type ClientManagedMcpServersListResponse,
  type ClientManagedMcpServerStateRequest,
  type ClientManagedMcpUsageListRequest,
  type ClientManagedMcpUsageListResponse,
  type ClientPrincipalMeRequest,
  type ClientPrincipalMeResponse,
  type ClientPrincipalUpdateRequest,
  type ClientPrincipalUpdateResponse,
  type ClientDirectRoomOpenRequest,
  type ClientDirectRoomOpenResponse,
  type ClientRoomSyncRequest,
  type ClientRoomSyncResponse,
  type ClientRoomArchiveRequest,
  type ClientRoomCreateRequest,
  type ClientRoomDeleteRequest,
  type ClientRoomDeleteResponse,
  type ClientRoomLeaveRequest,
  type ClientRoomAgentSosResponse,
  type ClientRoomAgentSosResumeRequest,
  type ClientRoomAgentSosStopRequest,
  type ClientRoomUnarchiveRequest,
  type ClientRoomUpdateRequest,
  type ClientRoomAgentActivityListRequest,
  type ClientRoomAgentActivityListResponse,
  type ClientRoomMemberAddRequest,
  type ClientRoomMemberMutationResponse,
  type ClientRoomMemberRemoveRequest,
  type ClientRoomMemberRemoveResponse,
  type ClientRoomMemberRoleRequest,
  type ClientRoomMembersListRequest,
  type ClientRoomMembersListResponse,
  type ClientRoomMutationResponse,
  type ClientRoomsListRequest,
  type ClientRoomsListResponse,
  type ClientTaskAttentionMutationResponse,
  type ClientTaskAssignRequest,
  type ClientTaskCancelRequest,
  type ClientTaskReopenRequest,
  type ClientTaskWorkflowUpdateRequest,
  type ClientTaskCompleteRequest,
  type ClientTaskConvertRequest,
  type ClientTaskCreateRequest,
  type ClientTaskMutationResponse,
  type ClientTaskReassignRequest,
  type ClientTaskReassignmentResponse,
  type ClientTaskUnassignRequest,
  type ClientTasksListRequest,
  type ClientTasksListResponse,
  type ClientTaskReviewEvidenceListRequest,
  type ClientTaskReviewEvidenceListResponse,
  type ClientTaskUnblockRequest,
  type ClientThreadCreateRequest,
  type ClientThreadCreateResponse,
  type ClientThreadReplyRequest,
  type ClientThreadsListRequest,
  type ClientThreadsListResponse,
  type ClientWorkspacesListRequest,
  type ClientWorkspacesListResponse,
  type ClientWorkspaceCreateRequest,
  type ClientWorkspaceUpdateRequest,
  type ClientWorkspaceMutationResponse,
  type ClientWorkspaceMemberGraphRequest,
  type ClientWorkspaceMemberGraphResponse,
  type ClientComputerProfileUpdateRequest,
  type ClientComputerProfileUpdateResponse,
  type InputRequestResolveRequest,
  type InputRequestResolveResponse,
  type LocalRuntimeInventoryRequest,
  type LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";
import type { ZodType } from "zod";
import {
  fileOperations,
  createFileTransport,
  type FileOperationMap,
  type RahFileTransport,
} from "./file-operations.ts";
export type { RahFileTransport } from "./file-operations.ts";
import {
  createProfileImageTransport,
  type RahProfileImageTransport,
} from "./profile-image-transport.ts";
export type { RahProfileImageTransport } from "./profile-image-transport.ts";
import {
  discoveryOperations,
  type DiscoveryOperationMap,
} from "./discovery-operations.ts";

import {
  agentWorkspaceOperations,
  type AgentWorkspaceOperationMap,
} from "./agent-workspace-operations.ts";
export type RahClientOperationMap = AgentWorkspaceOperationMap &
  DiscoveryOperationMap &
  FileOperationMap & {
    "agent.memory.config.get": {
      input: ClientAgentMemoryConfigGetRequest;
      output: ClientAgentMemoryConfigResponse;
    };
    "agent.memory.config.patch": {
      input: ClientAgentMemoryConfigPatchRequest;
      output: ClientAgentMemoryConfigResponse;
    };
    "agent.activity.list": {
      input: ClientAgentActivityListRequest;
      output: ClientAgentActivityListResponse;
    };
    "agent.trajectory.list": {
      input: ClientAgentTrajectoryListRequest;
      output: ClientAgentTrajectoryListResponse;
    };
    "agent.presence.list": {
      input: ClientAgentPresenceListRequest;
      output: ClientAgentPresenceListResponse;
    };
    "agent.reminder.list": {
      input: ClientAgentRemindersListRequest;
      output: ClientAgentRemindersListResponse;
    };
    "agent.get": {
      input: ClientAgentGetRequest;
      output: ClientAgentGetResponse;
    };
    "agent.execution.reset": {
      input: ClientAgentExecutionResetRequest;
      output: ClientAgentExecutionResetResponse;
    };
    "agent.memory.get": {
      input: ClientAgentMemoryGetRequest;
      output: ClientAgentMemoryGetResponse;
    };
    "agent.memory.read": {
      input: ClientAgentMemoryReadRequest;
      output: ClientAgentMemoryReadResponse;
    };
    "agent.memory.reset": {
      input: ClientAgentMemoryResetRequest;
      output: ClientAgentMemoryResetResponse;
    };
    "agent.list": {
      input: ClientAgentsListRequest;
      output: ClientAgentsListResponse;
    };
    "agent.manage": {
      input: ClientAgentManageRequest;
      output: ClientAgentManageResponse;
    };
    "agent.onboard": {
      input: ClientAgentOnboardRequest;
      output: ClientRoomMemberMutationResponse;
    };
    "agent.provision": {
      input: ClientAgentProvisionRequest;
      output: ClientAgentProvisionResponse;
    };
    "agent.room.list": {
      input: ClientAgentRoomsListRequest;
      output: ClientAgentRoomsListResponse;
    };
    health: {
      input: Record<string, never>;
      output: ClientHealthResponse;
    };
    "host.runtime.list": {
      input: LocalRuntimeInventoryRequest;
      output: LocalRuntimeInventoryResponse;
    };
    "computer.profile.update": {
      input: ClientComputerProfileUpdateRequest;
      output: ClientComputerProfileUpdateResponse;
    };
    "inputRequest.list": {
      input: ClientInputRequestsListRequest;
      output: ClientInputRequestsListResponse;
    };
    "inputRequest.resolve": {
      input: InputRequestResolveRequest;
      output: InputRequestResolveResponse;
    };
    "managedMcp.assignment.create": {
      input: ClientManagedMcpAssignmentCreateRequest;
      output: ClientManagedMcpAssignmentMutationResponse;
    };
    "managedMcp.assignment.list": {
      input: ClientManagedMcpAssignmentsListRequest;
      output: ClientManagedMcpAssignmentsListResponse;
    };
    "managedMcp.assignment.revise": {
      input: ClientManagedMcpAssignmentReviseRequest;
      output: ClientManagedMcpAssignmentMutationResponse;
    };
    "managedMcp.assignment.state": {
      input: ClientManagedMcpAssignmentStateRequest;
      output: ClientManagedMcpAssignmentMutationResponse;
    };
    "managedMcp.executor.discover": {
      input: ClientManagedMcpExecutorDiscoverRequest;
      output: ClientManagedMcpExecutorDiscoverResponse;
    };
    "managedMcp.executor.list": {
      input: ClientManagedMcpExecutorsListRequest;
      output: ClientManagedMcpExecutorsListResponse;
    };
    "managedMcp.server.create": {
      input: ClientManagedMcpServerCreateRequest;
      output: ClientManagedMcpServerMutationResponse;
    };
    "managedMcp.server.list": {
      input: ClientManagedMcpServersListRequest;
      output: ClientManagedMcpServersListResponse;
    };
    "managedMcp.server.revise": {
      input: ClientManagedMcpServerReviseRequest;
      output: ClientManagedMcpServerMutationResponse;
    };
    "managedMcp.server.state": {
      input: ClientManagedMcpServerStateRequest;
      output: ClientManagedMcpServerMutationResponse;
    };
    "managedMcp.usage.list": {
      input: ClientManagedMcpUsageListRequest;
      output: ClientManagedMcpUsageListResponse;
    };
    "message.list": {
      input: ClientMessagesListRequest;
      output: ClientMessagesListResponse;
    };
    "message.forward.targets": {
      input: ClientMessageForwardTargetsRequest;
      output: ClientMessageForwardTargetsResponse;
    };
    "message.forward": {
      input: ClientMessageForwardRequest;
      output: ClientMessageForwardResponse;
    };
    "message.post": {
      input: ClientMessagePostRequest;
      output: ClientMessageMutationResponse;
    };
    "principal.me": {
      input: ClientPrincipalMeRequest;
      output: ClientPrincipalMeResponse;
    };
    "principal.update": {
      input: ClientPrincipalUpdateRequest;
      output: ClientPrincipalUpdateResponse;
    };
    "room.acknowledge": {
      input: ClientAcknowledgeRequest;
      output: ClientAcknowledgeResponse;
    };
    "room.create": {
      input: ClientRoomCreateRequest;
      output: ClientRoomMutationResponse;
    };
    "room.delete": {
      input: ClientRoomDeleteRequest;
      output: ClientRoomDeleteResponse;
    };
    "room.archive": {
      input: ClientRoomArchiveRequest;
      output: ClientRoomMutationResponse;
    };
    "room.leave": {
      input: ClientRoomLeaveRequest;
      output: ClientRoomMemberRemoveResponse;
    };
    "room.sos.resume": {
      input: ClientRoomAgentSosResumeRequest;
      output: ClientRoomAgentSosResponse;
    };
    "room.sos.stop": {
      input: ClientRoomAgentSosStopRequest;
      output: ClientRoomAgentSosResponse;
    };
    "room.unarchive": {
      input: ClientRoomUnarchiveRequest;
      output: ClientRoomMutationResponse;
    };
    "room.update": {
      input: ClientRoomUpdateRequest;
      output: ClientRoomMutationResponse;
    };
    "room.direct.open": {
      input: ClientDirectRoomOpenRequest;
      output: ClientDirectRoomOpenResponse;
    };
    "room.agent.activity.list": {
      input: ClientRoomAgentActivityListRequest;
      output: ClientRoomAgentActivityListResponse;
    };
    "room.list": {
      input: ClientRoomsListRequest;
      output: ClientRoomsListResponse;
    };
    "room.member.add": {
      input: ClientRoomMemberAddRequest;
      output: ClientRoomMemberMutationResponse;
    };
    "room.member.list": {
      input: ClientRoomMembersListRequest;
      output: ClientRoomMembersListResponse;
    };
    "room.member.remove": {
      input: ClientRoomMemberRemoveRequest;
      output: ClientRoomMemberRemoveResponse;
    };
    "room.member.role": {
      input: ClientRoomMemberRoleRequest;
      output: ClientRoomMemberMutationResponse;
    };
    "room.sync": {
      input: ClientRoomSyncRequest;
      output: ClientRoomSyncResponse;
    };
    "task.convert": {
      input: ClientTaskConvertRequest;
      output: ClientTaskAttentionMutationResponse;
    };
    "task.create": {
      input: ClientTaskCreateRequest;
      output: ClientTaskAttentionMutationResponse;
    };
    "task.assign": {
      input: ClientTaskAssignRequest;
      output: ClientTaskAttentionMutationResponse;
    };
    "task.cancel": {
      input: ClientTaskCancelRequest;
      output: ClientTaskAttentionMutationResponse;
    };
    "task.reopen": {
      input: ClientTaskReopenRequest;
      output: ClientTaskAttentionMutationResponse;
    };
    "task.workflow.update": {
      input: ClientTaskWorkflowUpdateRequest;
      output: ClientTaskAttentionMutationResponse;
    };
    "task.complete": {
      input: ClientTaskCompleteRequest;
      output: ClientTaskMutationResponse;
    };
    "task.list": {
      input: ClientTasksListRequest;
      output: ClientTasksListResponse;
    };
    "task.reassign": {
      input: ClientTaskReassignRequest;
      output: ClientTaskReassignmentResponse;
    };
    "task.review.list": {
      input: ClientTaskReviewEvidenceListRequest;
      output: ClientTaskReviewEvidenceListResponse;
    };
    "task.unassign": {
      input: ClientTaskUnassignRequest;
      output: ClientTaskAttentionMutationResponse;
    };
    "task.unblock": {
      input: ClientTaskUnblockRequest;
      output: ClientTaskAttentionMutationResponse;
    };
    "thread.create": {
      input: ClientThreadCreateRequest;
      output: ClientThreadCreateResponse;
    };
    "thread.list": {
      input: ClientThreadsListRequest;
      output: ClientThreadsListResponse;
    };
    "thread.reply": {
      input: ClientThreadReplyRequest;
      output: ClientMessageMutationResponse;
    };
    "workspace.list": {
      input: ClientWorkspacesListRequest;
      output: ClientWorkspacesListResponse;
    };
    "workspace.member-graph.get": {
      input: ClientWorkspaceMemberGraphRequest;
      output: ClientWorkspaceMemberGraphResponse;
    };
    "workspace.create": {
      input: ClientWorkspaceCreateRequest;
      output: ClientWorkspaceMutationResponse;
    };
    "workspace.update": {
      input: ClientWorkspaceUpdateRequest;
      output: ClientWorkspaceMutationResponse;
    };
  };

export type RahClientOperation = keyof RahClientOperationMap;
export type RahClientRequestOptions = { signal?: AbortSignal };

type OperationDefinition = {
  authenticated: boolean;
  input: ZodType;
  method: "GET" | "POST";
  output: ZodType;
  path: string;
};

const operationDefinitions: Record<RahClientOperation, OperationDefinition> = {
  ...discoveryOperations,
  ...fileOperations,
  ...agentWorkspaceOperations,
  "agent.activity.list": {
    authenticated: true,
    input: ClientAgentActivityListRequestSchema,
    method: "POST",
    output: ClientAgentActivityListResponseSchema,
    path: "/v3/client/agents/activity/list",
  },
  "agent.trajectory.list": {
    authenticated: true,
    input: ClientAgentTrajectoryListRequestSchema,
    method: "POST",
    output: ClientAgentTrajectoryListResponseSchema,
    path: "/v3/client/agents/trajectory/list",
  },
  "agent.presence.list": {
    authenticated: true,
    input: ClientAgentPresenceListRequestSchema,
    method: "POST",
    output: ClientAgentPresenceListResponseSchema,
    path: "/v3/client/agents/presence/list",
  },
  "agent.reminder.list": {
    authenticated: true,
    input: ClientAgentRemindersListRequestSchema,
    method: "POST",
    output: ClientAgentRemindersListResponseSchema,
    path: "/v3/client/agents/reminders/list",
  },
  "agent.get": {
    authenticated: true,
    input: ClientAgentGetRequestSchema,
    method: "POST",
    output: ClientAgentGetResponseSchema,
    path: "/v3/client/agents/get",
  },
  "agent.memory.get": {
    authenticated: true,
    input: ClientAgentMemoryGetRequestSchema,
    method: "POST",
    output: ClientAgentMemoryGetResponseSchema,
    path: "/v3/client/agents/memory/get",
  },
  "agent.execution.reset": {
    authenticated: true,
    input: ClientAgentExecutionResetRequestSchema,
    method: "POST",
    output: ClientAgentExecutionResetResponseSchema,
    path: "/v3/client/agents/execution/reset",
  },
  "agent.memory.config.get": {
    authenticated: true,
    input: ClientAgentMemoryConfigGetRequestSchema,
    method: "POST",
    output: ClientAgentMemoryConfigResponseSchema,
    path: "/v3/client/agents/memory/config/get",
  },
  "agent.memory.config.patch": {
    authenticated: true,
    input: ClientAgentMemoryConfigPatchRequestSchema,
    method: "POST",
    output: ClientAgentMemoryConfigResponseSchema,
    path: "/v3/client/agents/memory/config/patch",
  },
  "agent.memory.read": {
    authenticated: true,
    input: ClientAgentMemoryReadRequestSchema,
    method: "POST",
    output: ClientAgentMemoryReadResponseSchema,
    path: "/v3/client/agents/memory/read",
  },
  "agent.memory.reset": {
    authenticated: true,
    input: ClientAgentMemoryResetRequestSchema,
    method: "POST",
    output: ClientAgentMemoryResetResponseSchema,
    path: "/v3/client/agents/memory/reset",
  },
  "agent.list": {
    authenticated: true,
    input: ClientAgentsListRequestSchema,
    method: "POST",
    output: ClientAgentsListResponseSchema,
    path: "/v3/client/agents/list",
  },
  "agent.manage": {
    authenticated: true,
    input: ClientAgentManageRequestSchema,
    method: "POST",
    output: ClientAgentManageResponseSchema,
    path: "/v3/client/agents/manage",
  },
  "agent.onboard": {
    authenticated: true,
    input: ClientAgentOnboardRequestSchema,
    method: "POST",
    output: ClientRoomMemberMutationResponseSchema,
    path: "/v3/client/agents/onboard",
  },
  "agent.provision": {
    authenticated: true,
    input: ClientAgentProvisionRequestSchema,
    method: "POST",
    output: ClientAgentProvisionResponseSchema,
    path: "/v3/client/agents/provision",
  },
  "agent.room.list": {
    authenticated: true,
    input: ClientAgentRoomsListRequestSchema,
    method: "POST",
    output: ClientAgentRoomsListResponseSchema,
    path: "/v3/client/agents/rooms/list",
  },
  health: {
    authenticated: false,
    input: ClientWorkspacesListRequestSchema,
    method: "GET",
    output: ClientHealthResponseSchema,
    path: "/v3/client/health",
  },
  "host.runtime.list": {
    authenticated: true,
    input: LocalRuntimeInventoryRequestSchema,
    method: "POST",
    output: LocalRuntimeInventoryResponseSchema,
    path: "/v1/local/runtimes/list",
  },
  "computer.profile.update": {
    authenticated: true,
    input: ClientComputerProfileUpdateRequestSchema,
    method: "POST",
    output: ClientComputerProfileUpdateResponseSchema,
    path: "/v3/client/computers/profile/update",
  },
  "inputRequest.list": {
    authenticated: true,
    input: ClientInputRequestsListRequestSchema,
    method: "POST",
    output: ClientInputRequestsListResponseSchema,
    path: "/v3/client/input-requests/list",
  },
  "inputRequest.resolve": {
    authenticated: true,
    input: InputRequestResolveRequestSchema,
    method: "POST",
    output: InputRequestResolveResponseSchema,
    path: "/v3/client/input-requests/resolve",
  },
  "managedMcp.assignment.create": {
    authenticated: true,
    input: ClientManagedMcpAssignmentCreateRequestSchema,
    method: "POST",
    output: ClientManagedMcpAssignmentMutationResponseSchema,
    path: "/v3/client/managed-mcp/assignments/create",
  },
  "managedMcp.assignment.list": {
    authenticated: true,
    input: ClientManagedMcpAssignmentsListRequestSchema,
    method: "POST",
    output: ClientManagedMcpAssignmentsListResponseSchema,
    path: "/v3/client/managed-mcp/assignments/list",
  },
  "managedMcp.assignment.revise": {
    authenticated: true,
    input: ClientManagedMcpAssignmentReviseRequestSchema,
    method: "POST",
    output: ClientManagedMcpAssignmentMutationResponseSchema,
    path: "/v3/client/managed-mcp/assignments/revise",
  },
  "managedMcp.assignment.state": {
    authenticated: true,
    input: ClientManagedMcpAssignmentStateRequestSchema,
    method: "POST",
    output: ClientManagedMcpAssignmentMutationResponseSchema,
    path: "/v3/client/managed-mcp/assignments/state",
  },
  "managedMcp.executor.discover": {
    authenticated: true,
    input: ClientManagedMcpExecutorDiscoverRequestSchema,
    method: "POST",
    output: ClientManagedMcpExecutorDiscoverResponseSchema,
    path: "/v3/client/managed-mcp/executors/discover",
  },
  "managedMcp.executor.list": {
    authenticated: true,
    input: ClientManagedMcpExecutorsListRequestSchema,
    method: "POST",
    output: ClientManagedMcpExecutorsListResponseSchema,
    path: "/v3/client/managed-mcp/executors/list",
  },
  "managedMcp.server.create": {
    authenticated: true,
    input: ClientManagedMcpServerCreateRequestSchema,
    method: "POST",
    output: ClientManagedMcpServerMutationResponseSchema,
    path: "/v3/client/managed-mcp/servers/create",
  },
  "managedMcp.server.list": {
    authenticated: true,
    input: ClientManagedMcpServersListRequestSchema,
    method: "POST",
    output: ClientManagedMcpServersListResponseSchema,
    path: "/v3/client/managed-mcp/servers/list",
  },
  "managedMcp.server.revise": {
    authenticated: true,
    input: ClientManagedMcpServerReviseRequestSchema,
    method: "POST",
    output: ClientManagedMcpServerMutationResponseSchema,
    path: "/v3/client/managed-mcp/servers/revise",
  },
  "managedMcp.server.state": {
    authenticated: true,
    input: ClientManagedMcpServerStateRequestSchema,
    method: "POST",
    output: ClientManagedMcpServerMutationResponseSchema,
    path: "/v3/client/managed-mcp/servers/state",
  },
  "managedMcp.usage.list": {
    authenticated: true,
    input: ClientManagedMcpUsageListRequestSchema,
    method: "POST",
    output: ClientManagedMcpUsageListResponseSchema,
    path: "/v3/client/managed-mcp/usage/list",
  },
  "message.list": {
    authenticated: true,
    input: ClientMessagesListRequestSchema,
    method: "POST",
    output: ClientMessagesListResponseSchema,
    path: "/v3/client/messages/list",
  },
  "message.forward.targets": {
    authenticated: true,
    input: ClientMessageForwardTargetsRequestSchema,
    method: "POST",
    output: ClientMessageForwardTargetsResponseSchema,
    path: "/v3/client/messages/forward/targets",
  },
  "message.forward": {
    authenticated: true,
    input: ClientMessageForwardRequestSchema,
    method: "POST",
    output: ClientMessageForwardResponseSchema,
    path: "/v3/client/messages/forward",
  },
  "message.post": {
    authenticated: true,
    input: ClientMessagePostRequestSchema,
    method: "POST",
    output: ClientMessageMutationResponseSchema,
    path: "/v3/client/messages/post",
  },
  "principal.me": {
    authenticated: true,
    input: ClientPrincipalMeRequestSchema,
    method: "POST",
    output: ClientPrincipalMeResponseSchema,
    path: "/v3/client/principals/me",
  },
  "principal.update": {
    authenticated: true,
    input: ClientPrincipalUpdateRequestSchema,
    method: "POST",
    output: ClientPrincipalUpdateResponseSchema,
    path: "/v3/client/principals/update",
  },
  "room.acknowledge": {
    authenticated: true,
    input: ClientAcknowledgeRequestSchema,
    method: "POST",
    output: ClientAcknowledgeResponseSchema,
    path: "/v3/client/rooms/acknowledge",
  },
  "room.create": {
    authenticated: true,
    input: ClientRoomCreateRequestSchema,
    method: "POST",
    output: ClientRoomMutationResponseSchema,
    path: "/v3/client/rooms/create",
  },
  "room.delete": {
    authenticated: true,
    input: ClientRoomDeleteRequestSchema,
    method: "POST",
    output: ClientRoomDeleteResponseSchema,
    path: "/v3/client/rooms/delete",
  },
  "room.archive": {
    authenticated: true,
    input: ClientRoomArchiveRequestSchema,
    method: "POST",
    output: ClientRoomMutationResponseSchema,
    path: "/v3/client/rooms/archive",
  },
  "room.leave": {
    authenticated: true,
    input: ClientRoomLeaveRequestSchema,
    method: "POST",
    output: ClientRoomMemberRemoveResponseSchema,
    path: "/v3/client/rooms/leave",
  },
  "room.sos.resume": {
    authenticated: true,
    input: ClientRoomAgentSosResumeRequestSchema,
    method: "POST",
    output: ClientRoomAgentSosResponseSchema,
    path: "/v3/client/rooms/sos/resume",
  },
  "room.sos.stop": {
    authenticated: true,
    input: ClientRoomAgentSosStopRequestSchema,
    method: "POST",
    output: ClientRoomAgentSosResponseSchema,
    path: "/v3/client/rooms/sos/stop",
  },
  "room.unarchive": {
    authenticated: true,
    input: ClientRoomUnarchiveRequestSchema,
    method: "POST",
    output: ClientRoomMutationResponseSchema,
    path: "/v3/client/rooms/unarchive",
  },
  "room.update": {
    authenticated: true,
    input: ClientRoomUpdateRequestSchema,
    method: "POST",
    output: ClientRoomMutationResponseSchema,
    path: "/v3/client/rooms/update",
  },
  "room.direct.open": {
    authenticated: true,
    input: ClientDirectRoomOpenRequestSchema,
    method: "POST",
    output: ClientDirectRoomOpenResponseSchema,
    path: "/v3/client/rooms/direct/open",
  },
  "room.agent.activity.list": {
    authenticated: true,
    input: ClientRoomAgentActivityListRequestSchema,
    method: "POST",
    output: ClientRoomAgentActivityListResponseSchema,
    path: "/v3/client/rooms/agents/activity/list",
  },
  "room.list": {
    authenticated: true,
    input: ClientRoomsListRequestSchema,
    method: "POST",
    output: ClientRoomsListResponseSchema,
    path: "/v3/client/rooms/list",
  },
  "room.member.add": {
    authenticated: true,
    input: ClientRoomMemberAddRequestSchema,
    method: "POST",
    output: ClientRoomMemberMutationResponseSchema,
    path: "/v3/client/rooms/members/add",
  },
  "room.member.list": {
    authenticated: true,
    input: ClientRoomMembersListRequestSchema,
    method: "POST",
    output: ClientRoomMembersListResponseSchema,
    path: "/v3/client/rooms/members/list",
  },
  "room.member.remove": {
    authenticated: true,
    input: ClientRoomMemberRemoveRequestSchema,
    method: "POST",
    output: ClientRoomMemberRemoveResponseSchema,
    path: "/v3/client/rooms/members/remove",
  },
  "room.member.role": {
    authenticated: true,
    input: ClientRoomMemberRoleRequestSchema,
    method: "POST",
    output: ClientRoomMemberMutationResponseSchema,
    path: "/v3/client/rooms/members/role",
  },
  "room.sync": {
    authenticated: true,
    input: ClientRoomSyncRequestSchema,
    method: "POST",
    output: ClientRoomSyncResponseSchema,
    path: "/v3/client/rooms/sync",
  },
  "task.create": {
    authenticated: true,
    input: ClientTaskCreateRequestSchema,
    method: "POST",
    output: ClientTaskAttentionMutationResponseSchema,
    path: "/v3/client/tasks/create",
  },
  "task.assign": {
    authenticated: true,
    input: ClientTaskAssignRequestSchema,
    method: "POST",
    output: ClientTaskAttentionMutationResponseSchema,
    path: "/v3/client/tasks/assign",
  },
  "task.cancel": {
    authenticated: true,
    input: ClientTaskCancelRequestSchema,
    method: "POST",
    output: ClientTaskAttentionMutationResponseSchema,
    path: "/v3/client/tasks/cancel",
  },
  "task.reopen": {
    authenticated: true,
    input: ClientTaskReopenRequestSchema,
    method: "POST",
    output: ClientTaskAttentionMutationResponseSchema,
    path: "/v3/client/tasks/reopen",
  },
  "task.workflow.update": {
    authenticated: true,
    input: ClientTaskWorkflowUpdateRequestSchema,
    method: "POST",
    output: ClientTaskAttentionMutationResponseSchema,
    path: "/v3/client/tasks/workflow",
  },
  "task.complete": {
    authenticated: true,
    input: ClientTaskCompleteRequestSchema,
    method: "POST",
    output: ClientTaskMutationResponseSchema,
    path: "/v3/client/tasks/complete",
  },
  "task.convert": {
    authenticated: true,
    input: ClientTaskConvertRequestSchema,
    method: "POST",
    output: ClientTaskAttentionMutationResponseSchema,
    path: "/v3/client/tasks/convert",
  },
  "task.list": {
    authenticated: true,
    input: ClientTasksListRequestSchema,
    method: "POST",
    output: ClientTasksListResponseSchema,
    path: "/v3/client/tasks/list",
  },
  "task.reassign": {
    authenticated: true,
    input: ClientTaskReassignRequestSchema,
    method: "POST",
    output: ClientTaskReassignmentResponseSchema,
    path: "/v3/client/tasks/reassign",
  },
  "task.review.list": {
    authenticated: true,
    input: ClientTaskReviewEvidenceListRequestSchema,
    method: "POST",
    output: ClientTaskReviewEvidenceListResponseSchema,
    path: "/v3/client/tasks/reviews/list",
  },
  "task.unassign": {
    authenticated: true,
    input: ClientTaskUnassignRequestSchema,
    method: "POST",
    output: ClientTaskAttentionMutationResponseSchema,
    path: "/v3/client/tasks/unassign",
  },
  "task.unblock": {
    authenticated: true,
    input: ClientTaskUnblockRequestSchema,
    method: "POST",
    output: ClientTaskAttentionMutationResponseSchema,
    path: "/v3/client/tasks/unblock",
  },
  "thread.create": {
    authenticated: true,
    input: ClientThreadCreateRequestSchema,
    method: "POST",
    output: ClientThreadCreateResponseSchema,
    path: "/v3/client/threads/create",
  },
  "thread.list": {
    authenticated: true,
    input: ClientThreadsListRequestSchema,
    method: "POST",
    output: ClientThreadsListResponseSchema,
    path: "/v3/client/threads/list",
  },
  "thread.reply": {
    authenticated: true,
    input: ClientThreadReplyRequestSchema,
    method: "POST",
    output: ClientMessageMutationResponseSchema,
    path: "/v3/client/threads/reply",
  },
  "workspace.list": {
    authenticated: true,
    input: ClientWorkspacesListRequestSchema,
    method: "POST",
    output: ClientWorkspacesListResponseSchema,
    path: "/v3/client/workspaces/list",
  },
  "workspace.member-graph.get": {
    authenticated: true,
    input: ClientWorkspaceMemberGraphRequestSchema,
    method: "POST",
    output: ClientWorkspaceMemberGraphResponseSchema,
    path: "/v3/client/workspaces/member-graph",
  },
  "workspace.create": {
    authenticated: true,
    input: ClientWorkspaceCreateRequestSchema,
    method: "POST",
    output: ClientWorkspaceMutationResponseSchema,
    path: "/v3/client/workspaces/create",
  },
  "workspace.update": {
    authenticated: true,
    input: ClientWorkspaceUpdateRequestSchema,
    method: "POST",
    output: ClientWorkspaceMutationResponseSchema,
    path: "/v3/client/workspaces/update",
  },
};

export const RAH_CLIENT_OPERATION_NAMES = Object.freeze(
  Object.keys(operationDefinitions).sort() as RahClientOperation[],
);

export interface RahClient {
  readonly files?: RahFileTransport;
  readonly profileImages?: RahProfileImageTransport;
  request<Operation extends RahClientOperation>(
    operation: Operation,
    input: RahClientOperationMap[Operation]["input"],
    options?: RahClientRequestOptions,
  ): Promise<RahClientOperationMap[Operation]["output"]>;
}

export type FakeRahClientHandler = <Operation extends RahClientOperation>(
  operation: Operation,
  input: RahClientOperationMap[Operation]["input"],
  options?: RahClientRequestOptions,
) => Promise<unknown>;

export class FakeRahClient implements RahClient {
  readonly #handler: FakeRahClientHandler;

  constructor(handler: FakeRahClientHandler) {
    this.#handler = handler;
  }

  async request<Operation extends RahClientOperation>(
    operation: Operation,
    input: RahClientOperationMap[Operation]["input"],
    options?: RahClientRequestOptions,
  ): Promise<RahClientOperationMap[Operation]["output"]> {
    const definition = operationDefinitions[operation];
    const parsedInput = definition.input.parse(
      input,
    ) as RahClientOperationMap[Operation]["input"];
    const result = await this.#handler(operation, parsedInput, options);
    return definition.output.parse(
      result,
    ) as RahClientOperationMap[Operation]["output"];
  }
}

export type RahFetchInit = {
  body?: string;
  headers: Record<string, string>;
  method: "GET" | "POST";
  signal?: AbortSignal;
};

export type RahFetchResponse = {
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
  text?(): Promise<string>;
};

export type RahFetch = (
  url: string,
  init: RahFetchInit,
) => Promise<RahFetchResponse>;

export class RahClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "RahClientError";
    this.code = code;
    this.status = status;
  }
}

export class HttpRahClient implements RahClient {
  readonly files: RahFileTransport;
  readonly profileImages: RahProfileImageTransport;
  readonly #accessToken: () => string | undefined;
  readonly #baseUrl: string;
  readonly #fetch: RahFetch;

  constructor(options: {
    accessToken: () => string | undefined;
    baseUrl: string;
    fetch?: RahFetch;
    fileFetch?: typeof fetch;
  }) {
    this.#accessToken = options.accessToken;
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#fetch = options.fetch ?? defaultFetch;
    this.files = createFileTransport(
      this.#baseUrl,
      this.#accessToken,
      options.fileFetch,
    );
    this.profileImages = createProfileImageTransport(
      this.#baseUrl,
      this.#accessToken,
      options.fileFetch,
    );
  }

  async request<Operation extends RahClientOperation>(
    operation: Operation,
    input: RahClientOperationMap[Operation]["input"],
    options?: RahClientRequestOptions,
  ): Promise<RahClientOperationMap[Operation]["output"]> {
    const definition = operationDefinitions[operation];
    const body = definition.input.parse(input);
    const headers: Record<string, string> = { accept: "application/json" };
    if (definition.authenticated) {
      const accessToken = this.#accessToken();
      if (accessToken === undefined || accessToken.length === 0) {
        throw new RahClientError(
          "unauthenticated",
          "a Human access token is required",
          401,
        );
      }
      headers.authorization = `Bearer ${accessToken}`;
    }
    const init: RahFetchInit = {
      headers,
      method: definition.method,
      ...(definition.method === "POST"
        ? {
            body: JSON.stringify(body),
            headers: { ...headers, "content-type": "application/json" },
          }
        : {}),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    };
    const response = await this.#fetch(
      `${this.#baseUrl}${definition.path}`,
      init,
    );
    const payload = await responsePayload(response);
    if (!response.ok) {
      const error = clientError(payload);
      throw new RahClientError(error.code, error.message, response.status);
    }
    return definition.output.parse(
      payload,
    ) as RahClientOperationMap[Operation]["output"];
  }
}

const defaultFetch: RahFetch = async (url, init) => globalThis.fetch(url, init);

async function responsePayload(response: RahFetchResponse): Promise<unknown> {
  try {
    if (response.text !== undefined) {
      return JSON.parse(await response.text()) as unknown;
    }
    return await response.json();
  } catch {
    throw new RahClientError(
      response.ok ? "invalid_response" : "http_error",
      response.ok
        ? "RAH Client received a malformed response"
        : `RAH Client request failed with HTTP ${String(response.status)}`,
      response.status,
    );
  }
}

function clientError(payload: unknown): { code: string; message: string } {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "code" in payload.error &&
    "message" in payload.error
  ) {
    return {
      code: String(payload.error.code),
      message: String(payload.error.message),
    };
  }
  return { code: "http_error", message: "RAH Client request failed" };
}
