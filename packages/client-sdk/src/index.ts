import {
  ClientRoomTimelineRequestSchema,
  ClientRoomTimelineResponseSchema,
  type ClientRoomTimelineRequest,
  type ClientRoomTimelineResponse,
} from "@rah-os/protocol";
import {
  SideCreateResponseSchema,
  SideDiscardRequestSchema,
  SideDiscardResponseSchema,
  type SideCreateResponse,
  type SideDiscardRequest,
  type SideDiscardResponse,
} from "@rah-os/protocol";
import {
  InstanceForkRequestSchema,
  type InstanceForkRequest,
} from "@rah-os/protocol";
import {
  ClientMemoryDeleteRequestSchema,
  ClientMemoryImportLegacyRequestSchema,
  MemoryImportLegacyResponseSchema,
  type ClientMemoryImportLegacyRequest,
  type MemoryImportLegacyResponse,
  ClientMemoryEntryRequestSchema,
  ClientMemoryInvalidateRequestSchema,
  ClientMemoryListRequestSchema,
  ClientMemoryPinRequestSchema,
  ClientMemoryUpdateRequestSchema,
  ClientMemoryPolicyReadRequestSchema,
  ClientMemoryPolicyUpdateRequestSchema,
  ClientMemoryRestoreRequestSchema,
  ClientMemorySearchRequestSchema,
  MemoryHistoryResponseSchema,
  MemoryListResponseSchema,
  MemoryMutationResponseSchema,
  MemoryPolicySchema,
  MemoryPolicyUpdateResponseSchema,
  MemoryReadResponseSchema,
  MemorySearchResponseSchema,
  type ClientMemoryDeleteRequest,
  type ClientMemoryEntryRequest,
  type ClientMemoryInvalidateRequest,
  type ClientMemoryListRequest,
  type ClientMemoryPinRequest,
  type ClientMemoryUpdateRequest,
  type ClientMemoryPolicyReadRequest,
  type ClientMemoryPolicyUpdateRequest,
  type ClientMemoryRestoreRequest,
  type ClientMemorySearchRequest,
  type MemoryHistoryResponse,
  type MemoryListResponse,
  type MemoryMutationResponse,
  type MemoryPolicy,
  type MemoryPolicyUpdateResponse,
  type MemoryReadResponse,
  type MemorySearchResponse,
} from "@rah-os/protocol";
import {
  type RoleCreateRequest,
  type RoleRestoreRequest,
  RoleRestoreRequestSchema,
  type RoleDeleteRequest,
  type RoleDeleteResponse,
  RoleDeleteRequestSchema,
  RoleDeleteResponseSchema,
  type RoleReviseRequest,
  type RoleCreateResponse,
  type RoleListRequest,
  type RoleListResponse,
  type RoleInstantiateRequest,
  type RoleInstantiateResponse,
  type InstanceActivationAbandonRequest,
  type InstanceActivationAbandonResponse,
  type InstanceSessionResetRequest,
  type InstanceSessionResetResponse,
} from "@rah-os/protocol";
import {
  RoleCreateRequestSchema,
  RoleReviseRequestSchema,
  RoleCreateResponseSchema,
  RoleListRequestSchema,
  RoleListResponseSchema,
  RoleInstantiateRequestSchema,
  RoleInstantiateResponseSchema,
  InstanceActivationAbandonRequestSchema,
  InstanceActivationAbandonResponseSchema,
  InstanceSessionResetRequestSchema,
  InstanceSessionResetResponseSchema,
} from "@rah-os/protocol";
import {
  SystemChannelVisibilityReadSchema,
  SystemChannelVisibilityUpdateSchema,
  SystemChannelVisibilityResponseSchema,
  SystemChannelVisibilityMutationSchema,
  type SystemChannelVisibilityRead,
  type SystemChannelVisibilityUpdate,
  type SystemChannelVisibilityResponse,
  type SystemChannelVisibilityMutation,
} from "@rah-os/protocol";
import {
  RuntimeSettingsReadSchema,
  RuntimeSettingsSchema,
  RuntimeSettingsUpdateSchema,
  type RuntimeSettings,
  type RuntimeSettingsRead,
  type RuntimeSettingsUpdate,
} from "@rah-os/protocol";
import {
  RuntimeGuideReadSchema,
  type RuntimeGuideRead,
  RuntimeGuideUpdateSchema,
  RuntimeGuideSettingsSchema,
  type RuntimeGuideUpdate,
  type RuntimeGuideSettingsView,
} from "@rah-os/protocol";
import {
  TaskAmendRequestSchema,
  TaskDeleteRequestSchema,
  TaskDeleteResponseSchema,
  type TaskDeleteRequest,
  type TaskDeleteResponse,
  ClientTaskMutationResponseSchema,
  type ClientTaskMutationResponse,
  type TaskAmendRequest,
} from "@rah-os/protocol";
import {
  ClientTaskHistoryRequestSchema,
  ClientTaskHistoryResponseSchema,
  type ClientTaskHistoryRequest,
  type ClientTaskHistoryResponse,
} from "@rah-os/protocol";
import {
  ChannelPreviewRequestSchema,
  ChannelPreviewResponseSchema,
  type ChannelPreviewRequest,
  type ChannelPreviewResponse,
} from "@rah-os/protocol";
import {
  PublicChannelDirectoryRequestSchema,
  PublicChannelDirectoryResponseSchema,
  PublicChannelJoinRequestSchema,
  PublicChannelJoinResponseSchema,
  type PublicChannelDirectoryRequest,
  type PublicChannelDirectoryResponse,
  type PublicChannelJoinRequest,
  type PublicChannelJoinResponse,
} from "@rah-os/protocol";
import {
  ClientAgentActivityListRequestSchema,
  ClientAgentActivityListResponseSchema,
  ClientAgentTrajectoryListRequestSchema,
  ClientRunAttemptUsageGetRequestSchema,
  ClientRunAttemptUsageGetResponseSchema,
  UsageSummaryRequestSchema,
  UsageSummaryResponseSchema,
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
  ClientAgentRoomsListRequestSchema,
  ClientAgentRoomsListResponseSchema,
  ClientAgentDeletionDiagnosticsRequestSchema,
  ClientAgentDeletionDiagnosticsResponseSchema,
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
  ClientAgentsListRequestSchema,
  ClientAgentsListResponseSchema,
  ClientHealthResponseSchema,
  ClientInputRequestsListRequestSchema,
  ClientInputRequestsListResponseSchema,
  ClientMessageMutationResponseSchema,
  ClientMessageReferenceReadStatesRequestSchema,
  ClientMessageReferenceReadStatesResponseSchema,
  ClientMessageForwardRequestSchema,
  ClientMessageForwardResponseSchema,
  ClientMessageForwardTargetsRequestSchema,
  ClientMessageForwardTargetsResponseSchema,
  ClientMessagePostRequestSchema,
  ClientMessagesListRequestSchema,
  ClientMessagesListResponseSchema,
  ClientPrincipalMeRequestSchema,
  HumanProfileRequestSchema,
  HumanProfileResponseSchema,
  type HumanProfileRequest,
  type HumanProfileResponse,
  WorkspaceHumanDirectoryRequestSchema,
  WorkspaceHumanDirectoryResponseSchema,
  type WorkspaceHumanDirectoryRequest,
  type WorkspaceHumanDirectoryResponse,
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
  ClientTaskReassignRequestSchema,
  ClientTaskReassignmentResponseSchema,
  ClientTaskUnassignRequestSchema,
  ClientTaskGetRequestSchema,
  ClientTaskGetResponseSchema,
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
  type ClientRunAttemptUsageGetRequest,
  type ClientRunAttemptUsageGetResponse,
  type UsageSummaryRequest,
  type UsageSummaryResponse,
  type ClientAgentTrajectoryListResponse,
  type ClientAgentRoomsListRequest,
  type ClientAgentRoomsListResponse,
  type ClientAgentDeletionDiagnosticsRequest,
  type ClientAgentDeletionDiagnosticsResponse,
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
  type ClientAgentsListRequest,
  type ClientAgentsListResponse,
  type ClientHealthResponse,
  type ClientInputRequestsListRequest,
  type ClientInputRequestsListResponse,
  type ClientMessageMutationResponse,
  type ClientMessageReferenceReadStatesRequest,
  type ClientMessageReferenceReadStatesResponse,
  type ClientMessageForwardRequest,
  type ClientMessageForwardResponse,
  type ClientMessageForwardTargetsRequest,
  type ClientMessageForwardTargetsResponse,
  type ClientMessagePostRequest,
  type ClientMessagesListRequest,
  type ClientMessagesListResponse,
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
  type ClientTaskReassignRequest,
  type ClientTaskReassignmentResponse,
  type ClientTaskUnassignRequest,
  type ClientTaskGetRequest,
  type ClientTaskGetResponse,
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
import {
  composerOperations,
  type ComposerOperationMap,
} from "./composer-operations.ts";
export type RahClientOperationMap = ComposerOperationMap &
  AgentWorkspaceOperationMap &
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
    "agent.run.usage.get": {
      input: ClientRunAttemptUsageGetRequest;
      output: ClientRunAttemptUsageGetResponse;
    };
    "usage.summary": {
      input: UsageSummaryRequest;
      output: UsageSummaryResponse;
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
    "agent.deletion.diagnostics": {
      input: ClientAgentDeletionDiagnosticsRequest;
      output: ClientAgentDeletionDiagnosticsResponse;
    };
    "agent.manage": {
      input: ClientAgentManageRequest;
      output: ClientAgentManageResponse;
    };
    "role.restore": { input: RoleRestoreRequest; output: RoleCreateResponse };
    "role.delete": { input: RoleDeleteRequest; output: RoleDeleteResponse };
    "role.revise": { input: RoleReviseRequest; output: RoleCreateResponse };
    "role.create": { input: RoleCreateRequest; output: RoleCreateResponse };
    "role.list": { input: RoleListRequest; output: RoleListResponse };
    "role.instantiate": {
      input: RoleInstantiateRequest;
      output: RoleInstantiateResponse;
    };
    "side.create": { input: InstanceForkRequest; output: SideCreateResponse };
    "side.discard": { input: SideDiscardRequest; output: SideDiscardResponse };
    "instance.fork": {
      input: InstanceForkRequest;
      output: RoleInstantiateResponse;
    };
    "instance.session.reset": {
      input: InstanceSessionResetRequest;
      output: InstanceSessionResetResponse;
    };
    "instance.activation.abandon": {
      input: InstanceActivationAbandonRequest;
      output: InstanceActivationAbandonResponse;
    };
    "memory.list": {
      input: ClientMemoryListRequest;
      output: MemoryListResponse;
    };
    "memory.read": {
      input: ClientMemoryEntryRequest;
      output: MemoryReadResponse;
    };
    "memory.search": {
      input: ClientMemorySearchRequest;
      output: MemorySearchResponse;
    };
    "memory.history": {
      input: ClientMemoryEntryRequest;
      output: MemoryHistoryResponse;
    };
    "memory.invalidate": {
      input: ClientMemoryInvalidateRequest;
      output: MemoryMutationResponse;
    };
    "memory.restore": {
      input: ClientMemoryRestoreRequest;
      output: MemoryMutationResponse;
    };
    "memory.delete": {
      input: ClientMemoryDeleteRequest;
      output: MemoryMutationResponse;
    };
    "memory.update": {
      input: ClientMemoryUpdateRequest;
      output: MemoryMutationResponse;
    };
    "memory.pin": {
      input: ClientMemoryPinRequest;
      output: MemoryMutationResponse;
    };
    "memory.import.legacy": {
      input: ClientMemoryImportLegacyRequest;
      output: MemoryImportLegacyResponse;
    };
    "memory.policy.read": {
      input: ClientMemoryPolicyReadRequest;
      output: MemoryPolicy;
    };
    "memory.policy.update": {
      input: ClientMemoryPolicyUpdateRequest;
      output: MemoryPolicyUpdateResponse;
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
    "runtime.guide.read": {
      input: RuntimeGuideRead;
      output: RuntimeGuideSettingsView;
    };
    "runtime.guide.update": {
      input: RuntimeGuideUpdate;
      output: RuntimeGuideSettingsView;
    };
    "runtime.settings.read": {
      input: RuntimeSettingsRead;
      output: RuntimeSettings;
    };
    "runtime.settings.update": {
      input: RuntimeSettingsUpdate;
      output: RuntimeSettings;
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

    "message.list": {
      input: ClientMessagesListRequest;
      output: ClientMessagesListResponse;
    };
    "message.reference.read-state.list": {
      input: ClientMessageReferenceReadStatesRequest;
      output: ClientMessageReferenceReadStatesResponse;
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
    "human.profile": {
      input: HumanProfileRequest;
      output: HumanProfileResponse;
    };
    "workspace.human.list": {
      input: WorkspaceHumanDirectoryRequest;
      output: WorkspaceHumanDirectoryResponse;
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
    "workspace.system-channel.read": {
      input: SystemChannelVisibilityRead;
      output: SystemChannelVisibilityResponse;
    };
    "workspace.system-channel.update": {
      input: SystemChannelVisibilityUpdate;
      output: SystemChannelVisibilityMutation;
    };
    "room.archive": {
      input: ClientRoomArchiveRequest;
      output: ClientRoomMutationResponse;
    };
    "room.preview": {
      input: ChannelPreviewRequest;
      output: ChannelPreviewResponse;
    };
    "room.public.discover": {
      input: PublicChannelDirectoryRequest;
      output: PublicChannelDirectoryResponse;
    };
    "room.public.join": {
      input: PublicChannelJoinRequest;
      output: PublicChannelJoinResponse;
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
    "room.timeline": {
      input: ClientRoomTimelineRequest;
      output: ClientRoomTimelineResponse;
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
      output: ClientTaskAttentionMutationResponse;
    };
    "task.get": {
      input: ClientTaskGetRequest;
      output: ClientTaskGetResponse;
    };
    "task.delete": {
      input: TaskDeleteRequest;
      output: TaskDeleteResponse;
    };
    "task.amend": {
      input: TaskAmendRequest;
      output: ClientTaskMutationResponse;
    };
    "task.history": {
      input: ClientTaskHistoryRequest;
      output: ClientTaskHistoryResponse;
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
  "workspace.system-channel.read": {
    authenticated: true,
    input: SystemChannelVisibilityReadSchema,
    output: SystemChannelVisibilityResponseSchema,
    method: "POST",
    path: "/v3/client/workspaces/system-channel/read",
  },
  "workspace.system-channel.update": {
    authenticated: true,
    input: SystemChannelVisibilityUpdateSchema,
    output: SystemChannelVisibilityMutationSchema,
    method: "POST",
    path: "/v3/client/workspaces/system-channel/update",
  },
  ...discoveryOperations,
  ...fileOperations,
  ...agentWorkspaceOperations,
  ...composerOperations,
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
  "agent.run.usage.get": {
    authenticated: true,
    input: ClientRunAttemptUsageGetRequestSchema,
    method: "POST",
    output: ClientRunAttemptUsageGetResponseSchema,
    path: "/v3/client/agents/run-usage/get",
  },
  "usage.summary": {
    authenticated: true,
    input: UsageSummaryRequestSchema,
    method: "POST",
    output: UsageSummaryResponseSchema,
    path: "/v3/client/usage/summary",
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
  "agent.deletion.diagnostics": {
    authenticated: true,
    input: ClientAgentDeletionDiagnosticsRequestSchema,
    method: "POST",
    output: ClientAgentDeletionDiagnosticsResponseSchema,
    path: "/v3/client/agents/deletion/diagnostics",
  },
  "agent.manage": {
    authenticated: true,
    input: ClientAgentManageRequestSchema,
    method: "POST",
    output: ClientAgentManageResponseSchema,
    path: "/v3/client/agents/manage",
  },
  "role.restore": {
    authenticated: true,
    input: RoleRestoreRequestSchema,
    output: RoleCreateResponseSchema,
    method: "POST",
    path: "/v3/client/roles/restore",
  },
  "role.delete": {
    authenticated: true,
    input: RoleDeleteRequestSchema,
    output: RoleDeleteResponseSchema,
    method: "POST",
    path: "/v3/client/roles/delete",
  },
  "role.revise": {
    authenticated: true,
    input: RoleReviseRequestSchema,
    output: RoleCreateResponseSchema,
    method: "POST",
    path: "/v3/client/roles/revise",
  },
  "role.create": {
    authenticated: true,
    input: RoleCreateRequestSchema,
    output: RoleCreateResponseSchema,
    method: "POST",
    path: "/v3/client/roles/create",
  },
  "role.list": {
    authenticated: true,
    input: RoleListRequestSchema,
    output: RoleListResponseSchema,
    method: "POST",
    path: "/v3/client/roles/list",
  },
  "role.instantiate": {
    authenticated: true,
    input: RoleInstantiateRequestSchema,
    output: RoleInstantiateResponseSchema,
    method: "POST",
    path: "/v3/client/roles/instantiate",
  },
  "side.create": {
    authenticated: true,
    input: InstanceForkRequestSchema,
    output: SideCreateResponseSchema,
    method: "POST",
    path: "/v3/client/sides/create",
  },
  "side.discard": {
    authenticated: true,
    input: SideDiscardRequestSchema,
    output: SideDiscardResponseSchema,
    method: "POST",
    path: "/v3/client/sides/discard",
  },
  "instance.fork": {
    authenticated: true,
    input: InstanceForkRequestSchema,
    output: RoleInstantiateResponseSchema,
    method: "POST",
    path: "/v3/client/instances/fork",
  },
  "instance.session.reset": {
    authenticated: true,
    input: InstanceSessionResetRequestSchema,
    output: InstanceSessionResetResponseSchema,
    method: "POST",
    path: "/v3/client/instances/session/reset",
  },
  "instance.activation.abandon": {
    authenticated: true,
    input: InstanceActivationAbandonRequestSchema,
    output: InstanceActivationAbandonResponseSchema,
    method: "POST",
    path: "/v3/client/instances/activation/abandon",
  },
  "memory.list": {
    authenticated: true,
    input: ClientMemoryListRequestSchema,
    output: MemoryListResponseSchema,
    method: "POST",
    path: "/v3/client/memory/list",
  },
  "memory.read": {
    authenticated: true,
    input: ClientMemoryEntryRequestSchema,
    output: MemoryReadResponseSchema,
    method: "POST",
    path: "/v3/client/memory/read",
  },
  "memory.search": {
    authenticated: true,
    input: ClientMemorySearchRequestSchema,
    output: MemorySearchResponseSchema,
    method: "POST",
    path: "/v3/client/memory/search",
  },
  "memory.history": {
    authenticated: true,
    input: ClientMemoryEntryRequestSchema,
    output: MemoryHistoryResponseSchema,
    method: "POST",
    path: "/v3/client/memory/history",
  },
  "memory.invalidate": {
    authenticated: true,
    input: ClientMemoryInvalidateRequestSchema,
    output: MemoryMutationResponseSchema,
    method: "POST",
    path: "/v3/client/memory/invalidate",
  },
  "memory.restore": {
    authenticated: true,
    input: ClientMemoryRestoreRequestSchema,
    output: MemoryMutationResponseSchema,
    method: "POST",
    path: "/v3/client/memory/restore",
  },
  "memory.delete": {
    authenticated: true,
    input: ClientMemoryDeleteRequestSchema,
    output: MemoryMutationResponseSchema,
    method: "POST",
    path: "/v3/client/memory/delete",
  },
  "memory.update": {
    authenticated: true,
    input: ClientMemoryUpdateRequestSchema,
    output: MemoryMutationResponseSchema,
    method: "POST",
    path: "/v3/client/memory/update",
  },
  "memory.pin": {
    authenticated: true,
    input: ClientMemoryPinRequestSchema,
    output: MemoryMutationResponseSchema,
    method: "POST",
    path: "/v3/client/memory/pin",
  },
  "memory.import.legacy": {
    authenticated: true,
    input: ClientMemoryImportLegacyRequestSchema,
    output: MemoryImportLegacyResponseSchema,
    method: "POST",
    path: "/v3/client/memory/import-legacy",
  },
  "memory.policy.read": {
    authenticated: true,
    input: ClientMemoryPolicyReadRequestSchema,
    output: MemoryPolicySchema,
    method: "POST",
    path: "/v3/client/memory/policy/read",
  },
  "memory.policy.update": {
    authenticated: true,
    input: ClientMemoryPolicyUpdateRequestSchema,
    output: MemoryPolicyUpdateResponseSchema,
    method: "POST",
    path: "/v3/client/memory/policy/update",
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
  "runtime.guide.read": {
    authenticated: true,
    input: RuntimeGuideReadSchema,
    method: "POST",
    output: RuntimeGuideSettingsSchema,
    path: "/v3/client/runtime-guide/read",
  },
  "runtime.guide.update": {
    authenticated: true,
    input: RuntimeGuideUpdateSchema,
    method: "POST",
    output: RuntimeGuideSettingsSchema,
    path: "/v3/client/runtime-guide/update",
  },
  "runtime.settings.read": {
    authenticated: true,
    input: RuntimeSettingsReadSchema,
    method: "POST",
    output: RuntimeSettingsSchema,
    path: "/v3/client/runtime-settings/read",
  },
  "runtime.settings.update": {
    authenticated: true,
    input: RuntimeSettingsUpdateSchema,
    method: "POST",
    output: RuntimeSettingsSchema,
    path: "/v3/client/runtime-settings/update",
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

  "message.list": {
    authenticated: true,
    input: ClientMessagesListRequestSchema,
    method: "POST",
    output: ClientMessagesListResponseSchema,
    path: "/v3/client/messages/list",
  },
  "message.reference.read-state.list": {
    authenticated: true,
    input: ClientMessageReferenceReadStatesRequestSchema,
    method: "POST",
    output: ClientMessageReferenceReadStatesResponseSchema,
    path: "/v3/client/messages/reference-read-states",
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
  "human.profile": {
    authenticated: true,
    input: HumanProfileRequestSchema,
    method: "POST",
    output: HumanProfileResponseSchema,
    path: "/v3/client/humans/profile",
  },
  "workspace.human.list": {
    authenticated: true,
    input: WorkspaceHumanDirectoryRequestSchema,
    method: "POST",
    output: WorkspaceHumanDirectoryResponseSchema,
    path: "/v3/client/workspaces/humans",
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
  "room.preview": {
    authenticated: true,
    input: ChannelPreviewRequestSchema,
    method: "POST",
    output: ChannelPreviewResponseSchema,
    path: "/v3/client/rooms/preview",
  },
  "room.public.discover": {
    authenticated: true,
    input: PublicChannelDirectoryRequestSchema,
    method: "POST",
    output: PublicChannelDirectoryResponseSchema,
    path: "/v3/client/rooms/public/discover",
  },
  "room.public.join": {
    authenticated: true,
    input: PublicChannelJoinRequestSchema,
    method: "POST",
    output: PublicChannelJoinResponseSchema,
    path: "/v3/client/rooms/public/join",
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
  "room.timeline": {
    authenticated: true,
    input: ClientRoomTimelineRequestSchema,
    method: "POST",
    output: ClientRoomTimelineResponseSchema,
    path: "/v3/client/rooms/timeline",
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
    output: ClientTaskAttentionMutationResponseSchema,
    path: "/v3/client/tasks/complete",
  },
  "task.convert": {
    authenticated: true,
    input: ClientTaskConvertRequestSchema,
    method: "POST",
    output: ClientTaskAttentionMutationResponseSchema,
    path: "/v3/client/tasks/convert",
  },
  "task.get": {
    authenticated: true,
    input: ClientTaskGetRequestSchema,
    method: "POST",
    output: ClientTaskGetResponseSchema,
    path: "/v3/client/tasks/get",
  },
  "task.delete": {
    authenticated: true,
    input: TaskDeleteRequestSchema,
    method: "POST",
    output: TaskDeleteResponseSchema,
    path: "/v3/client/tasks/delete",
  },
  "task.amend": {
    authenticated: true,
    input: TaskAmendRequestSchema,
    method: "POST",
    output: ClientTaskMutationResponseSchema,
    path: "/v3/client/tasks/amend",
  },
  "task.history": {
    authenticated: true,
    input: ClientTaskHistoryRequestSchema,
    method: "POST",
    output: ClientTaskHistoryResponseSchema,
    path: "/v3/client/tasks/history",
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
