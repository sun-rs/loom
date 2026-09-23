import {
  RoleCreateRequestSchema,
  RoleReviseRequestSchema,
  RoleCreateResponseSchema,
  RoleListRequestSchema,
  RoleListResponseSchema,
  RoleInstantiateRequestSchema,
  RoleInstantiateResponseSchema,
} from "@rah-os/protocol";
import { canonicalAgentIdField } from "@rah-os/protocol";
import {
  SystemChannelVisibilityReadSchema,
  SystemChannelVisibilityUpdateSchema,
  SystemChannelVisibilityResponseSchema,
  SystemChannelVisibilityMutationSchema,
} from "@rah-os/protocol";
import {
  RuntimeGuideReadSchema,
  RuntimeGuideUpdateSchema,
  RuntimeGuideSettingsSchema,
  type RuntimeGuideUpdate,
  type RuntimeGuideRead,
  type RuntimeGuideSettingsView,
} from "@rah-os/protocol";
import {
  TaskAmendRequestSchema,
  TaskDeleteRequestSchema,
  TaskDeleteResponseSchema,
  ClientTaskMutationResponseSchema,
} from "@rah-os/protocol";
import { createHash } from "node:crypto";
import {
  ClientTaskHistoryRequestSchema,
  ClientTaskHistoryResponseSchema,
} from "@rah-os/protocol";
import {
  AGENT_WORKSPACE_PATHS,
  routeAgentWorkspace,
  type AgentWorkspaceReadPort,
} from "./client-agent-workspace-routes.ts";
import {
  DISCOVERY_DATA_PATHS,
  routeDiscovery,
} from "./client-discovery-routes.ts";
import {
  COMPUTER_PROFILE_PATHS,
  routeComputerProfile,
  type ComputerProfileAdministrationPort,
} from "./client-computer-profile-routes.ts";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  type AuthenticatedActorContext,
  type HumanApplicationPort,
  KernelError,
  ForbiddenError,
  RuntimeTerminationProofError,
} from "@rah-os/kernel";
import {
  ClientAgentActivityListRequestSchema,
  ClientAgentActivityListResponseSchema,
  ClientAgentTrajectoryListRequestSchema,
  ClientAgentDeletionDiagnosticsRequestSchema,
  ClientAgentDeletionDiagnosticsResponseSchema,
  ClientAgentPresenceListRequestSchema,
  ClientAgentPresenceListResponseSchema,
  ClientAgentRemindersListRequestSchema,
  ClientAgentRemindersListResponseSchema,
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
  type AgentMemoryConfigSnapshot,
  type AgentMemoryConfigPatch,
  ClientAgentMemoryGetResponseSchema,
  ClientAgentMemoryReadRequestSchema,
  ClientAgentMemoryReadResponseSchema,
  ClientAgentMemoryResetRequestSchema,
  ClientAgentMemoryResetResponseSchema,
  ClientAgentProvisionRequestSchema,
  ClientAgentProvisionResponseSchema,
  ClientAgentsListRequestSchema,
  ClientAgentsListResponseSchema,
  ClientErrorResponseSchema,
  ClientHealthResponseSchema,
  ClientHealthV1ResponseSchema,
  ClientHealthV2ResponseSchema,
  ClientInputRequestsListRequestSchema,
  ClientInputRequestsListResponseSchema,
  ClientNotificationDismissRequestSchema,
  ClientNotificationDismissResponseSchema,
  ClientNotificationListRequestSchema,
  ClientNotificationListResponseSchema,
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
  ClientPrincipalMeResponseSchema,
  ClientPrincipalUpdateRequestSchema,
  ClientPrincipalUpdateResponseSchema,
  ClientDirectRoomOpenRequestSchema,
  ClientDirectRoomOpenResponseSchema,
  ClientRoomMemberAddRequestSchema,
  ClientRoomMemberMutationResponseSchema,
  ClientRoomMemberRemoveRequestSchema,
  ClientRoomMemberRemoveResponseSchema,
  ClientRoomMemberRoleRequestSchema,
  ClientRoomAgentActivityListRequestSchema,
  ClientRoomAgentActivityListResponseSchema,
  ClientRoomMembersListRequestSchema,
  ClientRoomMembersListResponseSchema,
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
  ClientRoomMutationResponseSchema,
  ClientRoomsListRequestSchema,
  ClientRoomsListResponseSchema,
  ClientRoomSyncRequestSchema,
  ClientRoomSyncResponseSchema,
  ClientTaskGetRequestSchema,
  ClientTaskGetResponseSchema,
  ClientTasksListRequestSchema,
  ClientTasksListResponseSchema,
  ClientTaskReviewEvidenceListRequestSchema,
  ClientTaskReviewEvidenceListResponseSchema,
  ClientTaskAssignRequestSchema,
  ClientTaskAttentionMutationResponseSchema,
  ClientTaskCancelRequestSchema,
  ClientTaskReopenRequestSchema,
  ClientTaskWorkflowUpdateRequestSchema,
  ClientTaskCompleteRequestSchema,
  ClientTaskConvertRequestSchema,
  ClientTaskCreateRequestSchema,
  ClientTaskReassignRequestSchema,
  ClientTaskReassignmentResponseSchema,
  ClientTaskUnassignRequestSchema,
  ClientTaskUnblockRequestSchema,
  ClientThreadCreateRequestSchema,
  ClientThreadCreateResponseSchema,
  ClientThreadReplyRequestSchema,
  ClientThreadsListRequestSchema,
  ClientThreadsListResponseSchema,
  ClientWorkspacesListRequestSchema,
  ClientWorkspacesListResponseSchema,
  ClientWorkspaceCreateRequestSchema,
  ClientWorkspaceUpdateRequestSchema,
  ClientWorkspaceMutationResponseSchema,
  ClientWorkspaceMemberGraphRequestSchema,
  ClientWorkspaceMemberGraphResponseSchema,
  InputRequestResolveRequestSchema,
  InputRequestResolveResponseSchema,
  LocalRuntimeInventoryRequestSchema,
  LocalRuntimeInventoryResponseSchema,
  type ClientHealthResponse,
  type ClientAgentExecutionResetRequest,
  type ClientAgentExecutionResetResponse,
  type ClientTaskReassignRequest,
  type ClientTaskReassignmentResponse,
  type AgentMemoryMaterializedFile,
  type AgentMemoryWorkspaceSnapshot,
  type LocalRuntimeInventoryResponse,
  type LocalRuntimeInventoryRequest,
} from "@rah-os/protocol";

import {
  ClientPushConfigurationRequestSchema,
  ClientPushConfigurationResponseSchema,
  ClientPushSubscribeRequestSchema,
  ClientPushSubscribeResponseSchema,
  ClientPushTestRequestSchema,
  ClientPushTestResponseSchema,
  ClientPushUnsubscribeRequestSchema,
  ClientPushUnsubscribeResponseSchema,
  type ClientPushConfigurationResponse,
  type ClientPushSubscribeRequest,
  type ClientPushUnsubscribeRequest,
  type NavigationTarget,
} from "@rah-os/protocol";

import {
  ProfileImageRequestError,
  transferProfileImage,
  type ProfileImageAdministrationPort,
} from "./client-profile-image-routes.ts";

import {
  ComputerFilesListRequestSchema,
  ComputerFilesListResponseSchema,
  RoomExecutionReadRequestSchema,
  RoomExecutionReadResponseSchema,
  type ComputerFilesListRequest,
  type ComputerFilesListResponse,
} from "@rah-os/protocol";

export type ClientApplicationServiceOptions = {
  computerFiles?: {
    list(input: ComputerFilesListRequest): Promise<ComputerFilesListResponse>;
  };
  runtimeGuideSettings?: {
    read(input?: RuntimeGuideRead): RuntimeGuideSettingsView;
    update(input: RuntimeGuideUpdate): RuntimeGuideSettingsView;
  };
  agentExecutionAdministration?: AgentExecutionAdministrationPort;
  agentMemoryAdministration?: AgentMemoryAdministrationPort;
  bindHost?: "127.0.0.1";
  computerProfileAdministration?: ComputerProfileAdministrationPort;
  health: () => ClientHealthResponse;
  human: HumanApplicationPort;
  localRuntimeInventory?: (
    actor: AuthenticatedActorContext,
    request?: LocalRuntimeInventoryRequest,
  ) => LocalRuntimeInventoryResponse | Promise<LocalRuntimeInventoryResponse>;

  port?: number;
  profileImages?: ProfileImageAdministrationPort;
  taskReassignmentAdministration?: TaskReassignmentAdministrationPort;
  webPushAdministration?: WebPushAdministrationPort;
};

export type AgentExecutionAdministrationPort = Readonly<{
  reset(
    actor: AuthenticatedActorContext,
    input: ClientAgentExecutionResetRequest,
  ):
    | Promise<ClientAgentExecutionResetResponse>
    | ClientAgentExecutionResetResponse;
}>;

export type TaskReassignmentAdministrationPort = Readonly<{
  reassign(
    actor: AuthenticatedActorContext,
    input: ClientTaskReassignRequest,
  ): Promise<ClientTaskReassignmentResponse> | ClientTaskReassignmentResponse;
}>;

export type WebPushAdministrationPort = Readonly<{
  configuration(
    actor: AuthenticatedActorContext,
  ): Promise<ClientPushConfigurationResponse> | ClientPushConfigurationResponse;
  subscribe(
    actor: AuthenticatedActorContext,
    input: ClientPushSubscribeRequest,
  ): Promise<{ subscribed: true; subscriptionCount: number }>;
  unsubscribe(
    actor: AuthenticatedActorContext,
    input: ClientPushUnsubscribeRequest,
  ): Promise<{ subscribed: false; subscriptionCount: number }>;
  test(
    actor: AuthenticatedActorContext,
    input: { target?: NavigationTarget | undefined },
  ): Promise<{ delivered: number }>;
}>;

export type AgentMemoryAdministrationPort = Readonly<{
  computerHostId: string;
  workspace?: AgentWorkspaceReadPort;
  getCleanerConfig?(
    ownerParticipantId: string,
  ): AgentMemoryConfigSnapshot | Promise<AgentMemoryConfigSnapshot>;
  patchCleanerConfig?(
    ownerParticipantId: string,
    patch: AgentMemoryConfigPatch,
  ): AgentMemoryConfigSnapshot | Promise<AgentMemoryConfigSnapshot>;
  inspectWorkspace(
    ownerParticipantId: string,
  ): Promise<AgentMemoryWorkspaceSnapshot> | AgentMemoryWorkspaceSnapshot;
  readWorkspaceFile(
    ownerParticipantId: string,
    relativePath: string,
  ):
    | Promise<
        Readonly<{
          content: string;
          file: AgentMemoryMaterializedFile;
          ownerParticipantId: string;
        }>
      >
    | Readonly<{
        content: string;
        file: AgentMemoryMaterializedFile;
        ownerParticipantId: string;
      }>;
  resetWorkspace(
    ownerParticipantId: string,
    idempotencyKey: string,
  ):
    | Promise<
        Readonly<{
          deduplicated: boolean;
          operationId: string;
          ownerParticipantId: string;
          providerContinuityRecords: number;
          resetAtMs: number;
        }>
      >
    | Readonly<{
        deduplicated: boolean;
        operationId: string;
        ownerParticipantId: string;
        providerContinuityRecords: number;
        resetAtMs: number;
      }>;
}>;

class HttpRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const MAX_BODY_BYTES = 1_024 * 1_024;
const CLIENT_V1_DATA_PATHS = new Set([
  "/input-requests/list",
  "/input-requests/resolve",
  "/rooms/acknowledge",
  "/rooms/sync",
  "/tasks/list",
  "/tasks/assign",
  "/tasks/cancel",
  "/tasks/reopen",
  "/tasks/complete",
  "/tasks/create",
  "/tasks/unblock",
]);
const CLIENT_V2_DATA_PATHS = new Set([
  ...CLIENT_V1_DATA_PATHS,
  "/messages/list",
  "/messages/post",
  "/rooms/list",
  "/rooms/members/add",
  "/rooms/members/list",
  "/rooms/members/remove",
  "/rooms/members/role",
  "/threads/create",
  "/threads/list",
  "/threads/reply",
  "/workspaces/list",
]);
const CLIENT_V3_DATA_PATHS = new Set([
  "/runtime-guide/read",
  "/runtime-guide/update",
  ...AGENT_WORKSPACE_PATHS,
  ...COMPUTER_PROFILE_PATHS,
  ...FILE_DATA_PATHS,
  ...DISCOVERY_DATA_PATHS,
  ...CLIENT_V2_DATA_PATHS,
  "/agents/activity/list",
  "/agents/trajectory/list",
  "/agents/presence/list",
  "/agents/reminders/list",
  "/agents/list",
  "/agents/get",
  "/agents/execution/reset",
  "/agents/memory/get",
  "/agents/memory/config/get",
  "/agents/memory/config/patch",
  "/agents/memory/read",
  "/agents/memory/reset",
  "/agents/rooms/list",
  "/agents/manage",
  "/agents/onboard",
  "/agents/provision",
  "/roles/create",
  "/roles/revise",
  "/roles/list",
  "/roles/instantiate",
  "/messages/forward",
  "/messages/forward/targets",
  "/messages/reference-read-states",
  "/notifications/list",
  "/notifications/dismiss",
  "/push/configuration",
  "/push/subscribe",
  "/push/unsubscribe",
  "/push/test",
  "/tasks/get",
  "/tasks/history",
  "/tasks/amend",
  "/tasks/delete",
  "/tasks/reviews/list",
  "/principals/me",
  "/principals/update",
  "/rooms/agents/activity/list",
  "/workspaces/system-channel/read",
  "/workspaces/system-channel/update",
  "/rooms/archive",
  "/rooms/create",
  "/rooms/delete",
  "/rooms/direct/open",
  "/rooms/leave",
  "/rooms/sos/resume",
  "/rooms/sos/stop",
  "/rooms/sos/read",
  "/computers/files/list",
  "/rooms/unarchive",
  "/rooms/update",
  "/tasks/convert",
  "/tasks/reassign",
  "/tasks/unassign",
  "/tasks/workflow",
  "/workspaces/create",
  "/workspaces/update",
  "/workspaces/member-graph",
]);
const MAX_DELIVERED_CURSORS_PER_CONSUMER = 1_024;

type ClientSession = {
  actor: AuthenticatedActorContext;
  credentialHash: string;
};

export class ClientApplicationService {
  readonly #computerFiles: ClientApplicationServiceOptions["computerFiles"];
  readonly #agentExecutionAdministration:
    AgentExecutionAdministrationPort | undefined;
  readonly #agentMemoryAdministration:
    AgentMemoryAdministrationPort | undefined;
  readonly #bindHost: "127.0.0.1";
  readonly #runtimeGuideSettings: ClientApplicationServiceOptions["runtimeGuideSettings"];
  readonly #computerProfileAdministration:
    ComputerProfileAdministrationPort | undefined;
  readonly #health: () => ClientHealthResponse;
  readonly #human: HumanApplicationPort;
  readonly #localRuntimeInventory:
    | ((
        actor: AuthenticatedActorContext,
        request?: LocalRuntimeInventoryRequest,
      ) =>
        LocalRuntimeInventoryResponse | Promise<LocalRuntimeInventoryResponse>)
    | undefined;

  readonly #taskReassignmentAdministration:
    TaskReassignmentAdministrationPort | undefined;
  readonly #webPushAdministration: WebPushAdministrationPort | undefined;
  readonly #port: number;
  readonly #profileImages: ProfileImageAdministrationPort | undefined;
  readonly #deliveredCursors = new Map<string, Set<number>>();
  #origin: string | undefined;
  #server: Server | undefined;

  constructor(options: ClientApplicationServiceOptions) {
    this.#computerFiles = options.computerFiles;
    this.#agentExecutionAdministration = options.agentExecutionAdministration;
    this.#agentMemoryAdministration = options.agentMemoryAdministration;
    this.#bindHost = options.bindHost ?? "127.0.0.1";
    this.#computerProfileAdministration = options.computerProfileAdministration;
    this.#runtimeGuideSettings = options.runtimeGuideSettings;
    this.#health = options.health;
    this.#human = options.human;
    this.#localRuntimeInventory = options.localRuntimeInventory;

    this.#taskReassignmentAdministration =
      options.taskReassignmentAdministration;
    this.#webPushAdministration = options.webPushAdministration;
    this.#port = options.port ?? 0;
    this.#profileImages = options.profileImages;
    if (
      !Number.isInteger(this.#port) ||
      this.#port < 0 ||
      this.#port > 65_535
    ) {
      throw new Error("port must be an integer between 0 and 65535");
    }
  }

  get origin(): string {
    if (this.#origin === undefined) {
      throw new Error("ClientApplicationService has not started");
    }
    return this.#origin;
  }

  async start(): Promise<void> {
    if (this.#server !== undefined) return;

    const server = createServer((request, response) => {
      void this.#handle(request, response).catch((error: unknown) => {
        this.#writeError(response, error);
      });
    });
    server.requestTimeout = 120_000;
    server.headersTimeout = 5_000;

    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(this.#port, this.#bindHost, () => {
        server.off("error", reject);
        resolvePromise();
      });
    });
    const address = server.address() as AddressInfo | null;
    if (address === null) {
      server.close();
      throw new Error("ClientApplicationService did not acquire an address");
    }
    this.#server = server;
    this.#origin = `http://${this.#bindHost}:${String(address.port)}`;
  }

  async close(): Promise<void> {
    this.#deliveredCursors.clear();
    this.#origin = undefined;
    const server = this.#server;
    this.#server = undefined;
    if (server === undefined || !server.listening) return;

    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise();
      });
    });
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const profileImageMatch =
      /^\/v3\/client\/profile-images\/content(?:\/([a-z0-9_-]{1,64}))?$/.exec(
        request.url ?? "",
      );
    if (profileImageMatch) {
      if (this.#profileImages === undefined) {
        throw new HttpRequestError(
          "not_found",
          "profile image storage is unavailable",
          404,
        );
      }
      try {
        await transferProfileImage(
          this.#profileImages,
          this.#authenticate(request).actor,
          request,
          response,
          profileImageMatch[1],
        );
      } catch (error) {
        if (error instanceof ProfileImageRequestError) {
          throw new HttpRequestError(error.code, error.message, error.status);
        }
        throw error;
      }
      return;
    }
    const fileMatch =
      /^\/v3\/client\/files\/(content|preview)\/([a-f0-9-]{36})$/.exec(
        request.url ?? "",
      );
    if (fileMatch) {
      if (request.method !== "PUT" && request.method !== "GET")
        throw new HttpRequestError(
          "method_not_allowed",
          "file content supports PUT / GET",
          405,
        );
      await transferFile(
        this.#human,
        this.#authenticate(request).actor,
        fileMatch[2]!,
        request,
        response,
        writeJson,
        fileMatch[1] === "preview" ? "preview" : "download",
      );
      return;
    }
    if (request.url === "/v1/local/runtimes/list") {
      if (this.#localRuntimeInventory === undefined) {
        throw new HttpRequestError("not_found", "route was not found", 404);
      }
      if (request.method !== "POST") {
        throw new HttpRequestError(
          "method_not_allowed",
          "local Runtime inventory only supports POST",
          405,
        );
      }
      const actor = this.#authenticate(request).actor;
      const inventoryRequest = parseClientRequest(
        LocalRuntimeInventoryRequestSchema,
        await readJsonObject(request),
      );
      writeJson(
        response,
        200,
        LocalRuntimeInventoryResponseSchema.parse(
          await this.#localRuntimeInventory(actor, inventoryRequest),
        ),
      );
      return;
    }
    const route = resolveClientRoute(request.url);
    if (route?.path === "/health") {
      if (request.method !== "GET") {
        throw new HttpRequestError(
          "method_not_allowed",
          "health only supports GET",
          405,
        );
      }
      const currentHealth = ClientHealthResponseSchema.parse(this.#health());
      writeJson(
        response,
        200,
        route.apiVersion === 1
          ? ClientHealthV1ResponseSchema.parse({
              apiVersion: 1,
              buildVersion: currentHealth.buildVersion,
              capabilities: {
                cursorAcknowledge: currentHealth.capabilities.cursorAcknowledge,
                hints: currentHealth.capabilities.hints,
                inputRequestRead: currentHealth.capabilities.inputRequestRead,
                inputRequestResolve:
                  currentHealth.capabilities.inputRequestResolve,
                roomSync: currentHealth.capabilities.roomSync,
                taskRead: currentHealth.capabilities.taskRead,
                taskWrite: currentHealth.capabilities.taskWrite,
              },
              kernelSchemaVersion: currentHealth.kernelSchemaVersion,
              protocolVersion: currentHealth.protocolVersion,
              state: currentHealth.state,
            })
          : route.apiVersion === 2
            ? ClientHealthV2ResponseSchema.parse({
                ...currentHealth,
                apiVersion: 2,
                capabilities: {
                  cursorAcknowledge:
                    currentHealth.capabilities.cursorAcknowledge,
                  hints: currentHealth.capabilities.hints,
                  inputRequestRead: currentHealth.capabilities.inputRequestRead,
                  inputRequestResolve:
                    currentHealth.capabilities.inputRequestResolve,
                  memberRead: currentHealth.capabilities.memberRead,
                  memberWrite: currentHealth.capabilities.memberWrite,
                  messageRead: currentHealth.capabilities.messageRead,
                  messageWrite: currentHealth.capabilities.messageWrite,
                  roomRead: currentHealth.capabilities.roomRead,
                  roomSync: currentHealth.capabilities.roomSync,
                  taskRead: currentHealth.capabilities.taskRead,
                  taskWrite: currentHealth.capabilities.taskWrite,
                  threadRead: currentHealth.capabilities.threadRead,
                  threadWrite: currentHealth.capabilities.threadWrite,
                  workspaceRead: currentHealth.capabilities.workspaceRead,
                },
              })
            : currentHealth,
      );
      return;
    }
    if (
      route === undefined ||
      !(
        route.apiVersion === 1
          ? CLIENT_V1_DATA_PATHS
          : route.apiVersion === 2
            ? CLIENT_V2_DATA_PATHS
            : CLIENT_V3_DATA_PATHS
      ).has(route.path)
    ) {
      throw new HttpRequestError("not_found", "route was not found", 404);
    }
    if (request.method !== "POST") {
      throw new HttpRequestError(
        "method_not_allowed",
        "data routes only support POST",
        405,
      );
    }

    const session = this.#authenticate(request);
    const actor = session.actor;
    const body = canonicalAgentIdField(await readJsonObject(request));
    if (body.target) body.target = canonicalAgentIdField(body.target);
    const path = route.path;
    if (AGENT_WORKSPACE_PATHS.includes(path)) {
      writeJson(
        response,
        200,
        await routeAgentWorkspace(
          this.#human,
          actor,
          path,
          body,
          this.#agentMemoryAdministration?.workspace,
          parseClientRequest,
        ),
      );
      return;
    }
    if (FILE_DATA_PATHS.includes(path)) {
      writeJson(
        response,
        200,
        routeFiles(this.#human, actor, path, body, parseClientRequest),
      );
      return;
    }
    if (DISCOVERY_DATA_PATHS.includes(path)) {
      writeJson(
        response,
        200,
        routeDiscovery(this.#human, actor, path, body, parseClientRequest),
      );
      return;
    }
    if (path === "/runtime-guide/read" || path === "/runtime-guide/update") {
      if (!this.#runtimeGuideSettings)
        throw new HttpRequestError(
          "not_found",
          "Runtime Guide settings unavailable",
          404,
        );
      const settingsInput = path.endsWith("/update")
        ? parseClientRequest(RuntimeGuideUpdateSchema, body)
        : parseClientRequest(RuntimeGuideReadSchema, body);
      if (settingsInput.agentId)
        this.#human.getWorkspaceAgentManagementView(
          actor,
          settingsInput.agentId,
        );
      const value = path.endsWith("/update")
        ? this.#runtimeGuideSettings.update(
            RuntimeGuideUpdateSchema.parse(settingsInput),
          )
        : this.#runtimeGuideSettings.read(settingsInput);
      writeJson(response, 200, RuntimeGuideSettingsSchema.parse(value));
      return;
    }
    if (COMPUTER_PROFILE_PATHS.includes(path)) {
      writeJson(
        response,
        200,
        await routeComputerProfile(
          actor,
          body,
          this.#computerProfileAdministration,
          parseClientRequest,
        ),
      );
      return;
    }
    if (path === "/push/configuration") {
      parseClientRequest(ClientPushConfigurationRequestSchema, body);
      writeJson(
        response,
        200,
        ClientPushConfigurationResponseSchema.parse(
          await this.#requireWebPushAdministration().configuration(actor),
        ),
      );
      return;
    }
    if (path === "/push/subscribe") {
      const command = parseClientRequest(
        ClientPushSubscribeRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientPushSubscribeResponseSchema.parse(
          await this.#requireWebPushAdministration().subscribe(actor, command),
        ),
      );
      return;
    }
    if (path === "/push/unsubscribe") {
      const command = parseClientRequest(
        ClientPushUnsubscribeRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientPushUnsubscribeResponseSchema.parse(
          await this.#requireWebPushAdministration().unsubscribe(
            actor,
            command,
          ),
        ),
      );
      return;
    }
    if (path === "/push/test") {
      const command = parseClientRequest(ClientPushTestRequestSchema, body);
      writeJson(
        response,
        200,
        ClientPushTestResponseSchema.parse(
          await this.#requireWebPushAdministration().test(actor, command),
        ),
      );
      return;
    }
    if (path === "/notifications/list") {
      const command = parseClientRequest(
        ClientNotificationListRequestSchema,
        body,
      );
      const dismissed = new Set(
        this.#human.listNotificationDismissals(actor, command).notificationIds,
      );
      const notifications = this.#localRuntimeInventory
        ? systemNotifications(
            LocalRuntimeInventoryResponseSchema.parse(
              await this.#localRuntimeInventory(actor),
            ),
          ).filter(
            (notification) => !dismissed.has(notification.notificationId),
          )
        : [];
      writeJson(
        response,
        200,
        ClientNotificationListResponseSchema.parse({ notifications }),
      );
      return;
    }
    if (path === "/notifications/dismiss") {
      const command = parseClientRequest(
        ClientNotificationDismissRequestSchema,
        body,
      );
      this.#human.listNotificationDismissals(actor, {
        workspaceId: command.workspaceId,
      });
      const notifications = this.#localRuntimeInventory
        ? systemNotifications(
            LocalRuntimeInventoryResponseSchema.parse(
              await this.#localRuntimeInventory(actor),
            ),
          )
        : [];
      const candidate = notifications.find(
        ({ notificationId }) => notificationId === command.notificationId,
      );
      if (candidate === undefined || !candidate.dismissible) {
        throw new HttpRequestError(
          "notification_unavailable",
          "notification is no longer available or cannot be dismissed",
          409,
        );
      }
      this.#human.dismissNotification(actor, command);
      writeJson(
        response,
        200,
        ClientNotificationDismissResponseSchema.parse({
          notificationId: command.notificationId,
        }),
      );
      return;
    }
    if (path === "/principals/me") {
      parseClientRequest(ClientPrincipalMeRequestSchema, body);
      writeJson(
        response,
        200,
        ClientPrincipalMeResponseSchema.parse({
          principal: this.#human.getAuthenticatedPrincipal(actor),
        }),
      );
      return;
    }
    if (path === "/principals/update") {
      const command = parseClientRequest(
        ClientPrincipalUpdateRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientPrincipalUpdateResponseSchema.parse({
          principal: this.#human.updateAuthenticatedPrincipal(actor, command),
        }),
      );
      return;
    }
    if (path === "/agents/list") {
      const command = parseClientRequest(ClientAgentsListRequestSchema, body);
      writeJson(
        response,
        200,
        ClientAgentsListResponseSchema.parse({
          agents: this.#human.listAgentCatalog(actor, {
            controlRoomId: command.controlRoomId,
            includeDeleted: command.includeDeleted ?? false,
          }),
        }),
      );
      return;
    }
    if (path === "/agents/get") {
      const command = parseClientRequest(ClientAgentGetRequestSchema, body);
      writeJson(
        response,
        200,
        ClientAgentGetResponseSchema.parse(
          this.#human.getWorkspaceAgentManagementView(actor, command.agentId),
        ),
      );
      return;
    }
    if (path === "/agents/execution/reset") {
      const command = parseClientRequest(
        ClientAgentExecutionResetRequestSchema,
        body,
      );
      const administration = this.#requireAgentExecutionAdministration();
      writeJson(
        response,
        200,
        ClientAgentExecutionResetResponseSchema.parse(
          await administration.reset(actor, command),
        ),
      );
      return;
    }
    if (
      path === "/agents/memory/config/get" ||
      path === "/agents/memory/config/patch"
    ) {
      const command = path.endsWith("/patch")
        ? parseClientRequest(ClientAgentMemoryConfigPatchRequestSchema, body)
        : parseClientRequest(ClientAgentMemoryConfigGetRequestSchema, body);
      const owner = this.#agentMemoryOwner(actor, command.agentId);
      const administration = this.#requireAgentMemoryAdministration();
      if (
        !administration.getCleanerConfig ||
        !administration.patchCleanerConfig
      )
        throw new HttpRequestError(
          "unavailable",
          "Computer cleaner configuration is unavailable",
          503,
        );
      try {
        const config =
          "patch" in command
            ? await administration.patchCleanerConfig(
                owner,
                ClientAgentMemoryConfigPatchRequestSchema.parse(body).patch,
              )
            : await administration.getCleanerConfig(owner);
        writeJson(
          response,
          200,
          ClientAgentMemoryConfigResponseSchema.parse({
            computerHostId: administration.computerHostId,
            config,
          }),
        );
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "agent_memory_config_conflict"
        )
          throw new HttpRequestError(
            "agent_memory_config_conflict",
            "Cleaner configuration changed; reload before saving",
            409,
          );
        throw error;
      }
      return;
    }
    if (path === "/agents/memory/get") {
      const command = parseClientRequest(
        ClientAgentMemoryGetRequestSchema,
        body,
      );
      const ownerParticipantId = this.#agentMemoryOwner(actor, command.agentId);
      const administration = this.#requireAgentMemoryAdministration();
      writeJson(
        response,
        200,
        ClientAgentMemoryGetResponseSchema.parse({
          computerHostId: administration.computerHostId,
          memory: await administration.inspectWorkspace(ownerParticipantId),
        }),
      );
      return;
    }
    if (path === "/agents/memory/read") {
      const command = parseClientRequest(
        ClientAgentMemoryReadRequestSchema,
        body,
      );
      const ownerParticipantId = this.#agentMemoryOwner(actor, command.agentId);
      const administration = this.#requireAgentMemoryAdministration();
      writeJson(
        response,
        200,
        ClientAgentMemoryReadResponseSchema.parse({
          computerHostId: administration.computerHostId,
          ...(await administration.readWorkspaceFile(
            ownerParticipantId,
            command.relativePath,
          )),
        }),
      );
      return;
    }
    if (path === "/agents/memory/reset") {
      const command = parseClientRequest(
        ClientAgentMemoryResetRequestSchema,
        body,
      );
      const ownerParticipantId = this.#agentMemoryOwner(actor, command.agentId);
      const administration = this.#requireAgentMemoryAdministration();
      const receipt = await administration.resetWorkspace(
        ownerParticipantId,
        command.idempotencyKey,
      );
      writeJson(
        response,
        200,
        ClientAgentMemoryResetResponseSchema.parse({
          computerHostId: administration.computerHostId,
          deduplicated: receipt.deduplicated,
          operationId: receipt.operationId,
          ownerParticipantId: receipt.ownerParticipantId,
          providerContinuityRecords: receipt.providerContinuityRecords,
          resetAt: new Date(receipt.resetAtMs).toISOString(),
        }),
      );
      return;
    }
    if (path === "/agents/activity/list") {
      const command = parseClientRequest(
        ClientAgentActivityListRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientAgentActivityListResponseSchema.parse(
          this.#human.listAgentActivity(actor, {
            agentId: command.agentId,
            ...(command.beforeActivityId === undefined
              ? {}
              : { beforeActivityId: command.beforeActivityId }),
            ...(command.limit === undefined ? {} : { limit: command.limit }),
          }),
        ),
      );
      return;
    }
    if (path === "/agents/reminders/list") {
      const command = parseClientRequest(
        ClientAgentRemindersListRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientAgentRemindersListResponseSchema.parse(
          this.#human.listAgentReminders(actor, command),
        ),
      );
      return;
    }
    if (path === "/agents/trajectory/list") {
      const command = parseClientRequest(
        ClientAgentTrajectoryListRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientAgentTrajectoryListResponseSchema.parse(
          this.#human.listAgentTrajectory(actor, {
            agentId: command.agentId,
            ...(command.beforeActivityId === undefined
              ? {}
              : { beforeActivityId: command.beforeActivityId }),
            ...(command.limit === undefined ? {} : { limit: command.limit }),
          }),
        ),
      );
      return;
    }
    if (path === "/agents/presence/list") {
      const command = parseClientRequest(
        ClientAgentPresenceListRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientAgentPresenceListResponseSchema.parse(
          this.#human.listAgentPresence(actor, command),
        ),
      );
      return;
    }
    if (path === "/agents/rooms/list") {
      const command = parseClientRequest(
        ClientAgentRoomsListRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientAgentRoomsListResponseSchema.parse({
          rooms: this.#human.listWorkspaceAgentRooms(actor, command),
        }),
      );
      return;
    }
    // R5: read-only projection of a blocked Agent deletion. No mutation, no
    // force delete; the durable intent remains the only way the Agent is
    // removed.
    if (path === "/agents/deletion/diagnostics") {
      const command = parseClientRequest(
        ClientAgentDeletionDiagnosticsRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientAgentDeletionDiagnosticsResponseSchema.parse(
          this.#human.getAgentDeletionDiagnostics(actor, command),
        ),
      );
      return;
    }
    if (path === "/agents/manage") {
      const command = parseClientRequest(ClientAgentManageRequestSchema, body);
      writeJson(
        response,
        200,
        ClientAgentManageResponseSchema.parse(
          await manageAgentAfterTerminalProof(this.#human, actor, command),
        ),
      );
      return;
    }
    if (path === "/agents/onboard") {
      const command = parseClientRequest(ClientAgentOnboardRequestSchema, body);
      writeJson(
        response,
        200,
        ClientRoomMemberMutationResponseSchema.parse(
          this.#human.onboardAgentToRoom(actor, command),
        ),
      );
      return;
    }
    if (path === "/roles/revise") {
      const command = parseClientRequest(RoleReviseRequestSchema, body);
      writeJson(
        response,
        200,
        RoleCreateResponseSchema.parse(this.#human.reviseRole(actor, command)),
      );
      return;
    }
    if (path === "/roles/create") {
      const command = parseClientRequest(RoleCreateRequestSchema, body);
      writeJson(
        response,
        200,
        RoleCreateResponseSchema.parse(this.#human.createRole(actor, command)),
      );
      return;
    }
    if (path === "/roles/list") {
      const command = parseClientRequest(RoleListRequestSchema, body);
      writeJson(
        response,
        200,
        RoleListResponseSchema.parse(this.#human.listRoles(actor, command)),
      );
      return;
    }
    if (path === "/roles/instantiate") {
      const command = parseClientRequest(RoleInstantiateRequestSchema, body);
      writeJson(
        response,
        200,
        RoleInstantiateResponseSchema.parse(
          this.#human.instantiateRole(actor, command),
        ),
      );
      return;
    }
    if (path === "/agents/provision") {
      const command = parseClientRequest(
        ClientAgentProvisionRequestSchema,
        body,
      );
      const { avatarKey, description, toolAccessMode, ...required } = command;
      writeJson(
        response,
        200,
        ClientAgentProvisionResponseSchema.parse(
          this.#human.provisionWorkspaceAgent(actor, {
            ...required,
            ...(avatarKey === undefined ? {} : { avatarKey }),
            ...(description === undefined ? {} : { description }),
            ...(toolAccessMode === undefined ? {} : { toolAccessMode }),
          }),
        ),
      );
      return;
    }
    if (path === "/workspaces/create") {
      const command = parseClientRequest(
        ClientWorkspaceCreateRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientWorkspaceMutationResponseSchema.parse(
          this.#human.createWorkspace(actor, command),
        ),
      );
      return;
    }
    if (path === "/workspaces/update") {
      const command = parseClientRequest(
        ClientWorkspaceUpdateRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientWorkspaceMutationResponseSchema.parse(
          this.#human.updateWorkspace(actor, command),
        ),
      );
      return;
    }
    if (path === "/workspaces/list") {
      parseClientRequest(ClientWorkspacesListRequestSchema, body);
      writeJson(
        response,
        200,
        ClientWorkspacesListResponseSchema.parse({
          workspaces: this.#human.listWorkspaces(actor),
        }),
      );
      return;
    }
    if (path === "/workspaces/member-graph") {
      const command = parseClientRequest(
        ClientWorkspaceMemberGraphRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientWorkspaceMemberGraphResponseSchema.parse(
          this.#human.listWorkspaceMemberGraph(actor, command),
        ),
      );
      return;
    }
    if (path === "/rooms/create") {
      const command = parseClientRequest(ClientRoomCreateRequestSchema, body);
      writeJson(
        response,
        200,
        ClientRoomMutationResponseSchema.parse(
          this.#human.createRoom(actor, command),
        ),
      );
      return;
    }
    if (path === "/workspaces/system-channel/read") {
      writeJson(
        response,
        200,
        SystemChannelVisibilityResponseSchema.parse(
          this.#human.getSystemChannelVisibility(
            actor,
            parseClientRequest(SystemChannelVisibilityReadSchema, body),
          ),
        ),
      );
      return;
    }
    if (path === "/workspaces/system-channel/update") {
      writeJson(
        response,
        200,
        SystemChannelVisibilityMutationSchema.parse(
          this.#human.updateSystemChannelVisibility(
            actor,
            parseClientRequest(SystemChannelVisibilityUpdateSchema, body),
          ),
        ),
      );
      return;
    }
    if (path === "/rooms/archive") {
      const command = parseClientRequest(ClientRoomArchiveRequestSchema, body);
      writeJson(
        response,
        200,
        ClientRoomMutationResponseSchema.parse(
          this.#human.archiveWorkspaceRoom(actor, command),
        ),
      );
      return;
    }
    if (path === "/rooms/delete") {
      const command = parseClientRequest(ClientRoomDeleteRequestSchema, body);
      writeJson(
        response,
        200,
        ClientRoomDeleteResponseSchema.parse(
          this.#human.deleteWorkspaceRoom(actor, command),
        ),
      );
      return;
    }
    if (path === "/rooms/leave") {
      const command = parseClientRequest(ClientRoomLeaveRequestSchema, body);
      writeJson(
        response,
        200,
        ClientRoomMemberRemoveResponseSchema.parse(
          this.#human.leaveRoom(actor, command),
        ),
      );
      return;
    }
    if (path === "/computers/files/list") {
      if (this.#human.getAuthenticatedPrincipal(actor).kind !== "human")
        throw new ForbiddenError(
          "Computer files require an authenticated Human",
        );
      if (!this.#computerFiles)
        throw new ForbiddenError("Computer file references are unavailable");
      const result = await this.#computerFiles.list(
        parseClientRequest(ComputerFilesListRequestSchema, body),
      );
      this.#human.getAuthenticatedPrincipal(actor);
      writeJson(response, 200, ComputerFilesListResponseSchema.parse(result));
      return;
    }
    if (path === "/rooms/sos/read") {
      writeJson(
        response,
        200,
        RoomExecutionReadResponseSchema.parse(
          this.#human.readRoomExecution(
            actor,
            parseClientRequest(RoomExecutionReadRequestSchema, body),
          ),
        ),
      );
      return;
    }
    if (path === "/rooms/sos/stop") {
      const command = parseClientRequest(
        ClientRoomAgentSosStopRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientRoomAgentSosResponseSchema.parse(
          await stopRoomAgentsAfterTerminalProof(this.#human, actor, command),
        ),
      );
      return;
    }
    if (path === "/rooms/sos/resume") {
      const command = parseClientRequest(
        ClientRoomAgentSosResumeRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientRoomAgentSosResponseSchema.parse(
          this.#human.resumeRoomAgentSos(actor, command),
        ),
      );
      return;
    }
    if (path === "/rooms/unarchive") {
      const command = parseClientRequest(
        ClientRoomUnarchiveRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientRoomMutationResponseSchema.parse(
          this.#human.unarchiveWorkspaceRoom(actor, command),
        ),
      );
      return;
    }
    if (path === "/rooms/update") {
      const command = parseClientRequest(ClientRoomUpdateRequestSchema, body);
      writeJson(
        response,
        200,
        ClientRoomMutationResponseSchema.parse(
          this.#human.updateWorkspaceRoom(actor, command),
        ),
      );
      return;
    }
    if (path === "/rooms/direct/open") {
      const command = parseClientRequest(
        ClientDirectRoomOpenRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientDirectRoomOpenResponseSchema.parse({
          room: this.#human.openDirectRoom(actor, command),
        }),
      );
      return;
    }
    if (path === "/rooms/list") {
      const command = parseClientRequest(ClientRoomsListRequestSchema, body);
      writeJson(
        response,
        200,
        ClientRoomsListResponseSchema.parse({
          rooms: this.#human.listRooms(actor, {
            ...(command.workspaceId === undefined
              ? {}
              : { workspaceId: command.workspaceId }),
          }),
        }),
      );
      return;
    }
    if (path === "/rooms/agents/activity/list") {
      const command = parseClientRequest(
        ClientRoomAgentActivityListRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientRoomAgentActivityListResponseSchema.parse({
          agents: this.#human.listRoomAgentActivity(actor, command),
        }),
      );
      return;
    }
    if (path === "/rooms/members/list") {
      const command = parseClientRequest(
        ClientRoomMembersListRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientRoomMembersListResponseSchema.parse({
          memberships: this.#human.listRoomMemberships(actor, command),
        }),
      );
      return;
    }
    if (path === "/rooms/members/add") {
      const command = parseClientRequest(
        ClientRoomMemberAddRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientRoomMemberMutationResponseSchema.parse(
          this.#human.addRoomMember(actor, command),
        ),
      );
      return;
    }
    if (path === "/rooms/members/role") {
      const command = parseClientRequest(
        ClientRoomMemberRoleRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientRoomMemberMutationResponseSchema.parse(
          this.#human.setRoomMemberRole(actor, command),
        ),
      );
      return;
    }
    if (path === "/rooms/members/remove") {
      const command = parseClientRequest(
        ClientRoomMemberRemoveRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientRoomMemberRemoveResponseSchema.parse(
          this.#human.removeRoomMember(actor, command),
        ),
      );
      return;
    }
    if (path === "/messages/list") {
      const command = parseClientRequest(ClientMessagesListRequestSchema, body);
      writeJson(
        response,
        200,
        ClientMessagesListResponseSchema.parse(
          this.#human.listMessages(actor, {
            ...(command.afterSeq === undefined
              ? {}
              : { afterSeq: command.afterSeq }),
            ...(command.beforeSeq === undefined
              ? {}
              : { beforeSeq: command.beforeSeq }),
            ...(command.limit === undefined ? {} : { limit: command.limit }),
            roomId: command.roomId,
            ...(command.threadId === undefined
              ? {}
              : { threadId: command.threadId }),
          }),
        ),
      );
      return;
    }
    if (path === "/messages/reference-read-states") {
      const command = parseClientRequest(
        ClientMessageReferenceReadStatesRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientMessageReferenceReadStatesResponseSchema.parse({
          readStates: this.#human.listMessageReferenceReadStates(
            actor,
            command,
          ),
        }),
      );
      return;
    }
    if (path === "/messages/post") {
      const command = parseClientRequest(ClientMessagePostRequestSchema, body);
      writeJson(
        response,
        200,
        ClientMessageMutationResponseSchema.parse(
          this.#human.postRoomMessage(actor, command),
        ),
      );
      return;
    }
    if (path === "/messages/forward/targets") {
      const command = parseClientRequest(
        ClientMessageForwardTargetsRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientMessageForwardTargetsResponseSchema.parse({
          rooms: this.#human.listMessageForwardTargets(actor, command),
        }),
      );
      return;
    }
    if (path === "/messages/forward") {
      const command = parseClientRequest(
        ClientMessageForwardRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientMessageForwardResponseSchema.parse(
          this.#human.forwardMessages(actor, command),
        ),
      );
      return;
    }
    if (path === "/threads/list") {
      const command = parseClientRequest(ClientThreadsListRequestSchema, body);
      writeJson(
        response,
        200,
        ClientThreadsListResponseSchema.parse({
          threads: this.#human.listThreads(actor, command),
        }),
      );
      return;
    }
    if (path === "/threads/create") {
      const command = parseClientRequest(ClientThreadCreateRequestSchema, body);
      writeJson(
        response,
        200,
        ClientThreadCreateResponseSchema.parse(
          this.#human.createThread(actor, command),
        ),
      );
      return;
    }
    if (path === "/threads/reply") {
      const command = parseClientRequest(ClientThreadReplyRequestSchema, body);
      writeJson(
        response,
        200,
        ClientMessageMutationResponseSchema.parse(
          this.#human.replyThread(actor, command),
        ),
      );
      return;
    }
    if (path === "/rooms/sync") {
      const command = parseClientRequest(ClientRoomSyncRequestSchema, body);
      const deliveryKey = this.#deliveryKey(session, command);
      const knownCursors = this.#deliveredCursors.get(deliveryKey);
      const delivery = this.#human.sync(actor, {
        ...(command.bootstrap === undefined
          ? {}
          : { bootstrap: command.bootstrap }),
        consumerId: command.consumerId,
        roomId: command.roomId,
        ...(command.afterSeq === undefined
          ? {}
          : { afterSeq: command.afterSeq }),
        ...(command.limit === undefined ? {} : { limit: command.limit }),
      });
      if (
        command.afterSeq !== undefined &&
        command.afterSeq > delivery.cursorBefore &&
        !knownCursors?.has(command.afterSeq)
      ) {
        throw new HttpRequestError(
          "invalid_continuation",
          "afterSeq was neither acknowledged nor delivered for this client credential",
          409,
        );
      }
      this.#rememberDeliveredCursor(deliveryKey, delivery.cursorAfter);
      writeJson(response, 200, ClientRoomSyncResponseSchema.parse(delivery));
      return;
    }
    if (path === "/rooms/acknowledge") {
      const command = parseClientRequest(ClientAcknowledgeRequestSchema, body);
      const deliveryKey = this.#deliveryKey(session, command);
      const durableCursor = this.#human.sync(actor, {
        consumerId: command.consumerId,
        limit: 1,
        roomId: command.roomId,
      }).cursorBefore;
      if (
        command.throughSeq > durableCursor &&
        !this.#deliveredCursors.get(deliveryKey)?.has(command.throughSeq)
      ) {
        throw new HttpRequestError(
          "cursor_not_delivered",
          "throughSeq was not delivered for this client credential",
          409,
        );
      }
      this.#human.acknowledgeCursor(actor, command);
      this.#forgetAcknowledgedCursors(deliveryKey, command.throughSeq);
      writeJson(
        response,
        200,
        ClientAcknowledgeResponseSchema.parse({
          acknowledgedThrough: command.throughSeq,
        }),
      );
      return;
    }
    if (path === "/tasks/get") {
      const command = parseClientRequest(ClientTaskGetRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTaskGetResponseSchema.parse({
          task: this.#human.getTask(actor, command),
        }),
      );
      return;
    }
    if (path === "/tasks/delete") {
      const command = parseClientRequest(TaskDeleteRequestSchema, body);
      writeJson(
        response,
        200,
        TaskDeleteResponseSchema.parse(this.#human.deleteTask(actor, command)),
      );
      return;
    }
    if (path === "/tasks/amend") {
      const command = parseClientRequest(TaskAmendRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTaskMutationResponseSchema.parse(
          this.#human.amendTask(actor, command),
        ),
      );
      return;
    }
    if (path === "/tasks/history") {
      const command = parseClientRequest(ClientTaskHistoryRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTaskHistoryResponseSchema.parse(
          this.#human.listTaskHistory(actor, command),
        ),
      );
      return;
    }
    if (path === "/tasks/list") {
      const command = parseClientRequest(ClientTasksListRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTasksListResponseSchema.parse({
          ...this.#human.listTaskPage(actor, {
            ...(command.beforeTaskNumber === undefined
              ? {}
              : { beforeTaskNumber: command.beforeTaskNumber }),
            ...(command.limit === undefined ? {} : { limit: command.limit }),
            roomId: command.roomId,
            ...(command.states === undefined ? {} : { states: command.states }),
          }),
        }),
      );
      return;
    }
    if (path === "/tasks/reviews/list") {
      const command = parseClientRequest(
        ClientTaskReviewEvidenceListRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientTaskReviewEvidenceListResponseSchema.parse({
          reviews: this.#human.listTaskReviews(actor, {
            ...(command.limit === undefined ? {} : { limit: command.limit }),
            roomId: command.roomId,
            ...(command.taskIds === undefined
              ? {}
              : { taskIds: command.taskIds }),
          }),
          submissions: this.#human.listTaskSubmissions(actor, {
            ...(command.limit === undefined ? {} : { limit: command.limit }),
            roomId: command.roomId,
            ...(command.taskIds === undefined
              ? {}
              : { taskIds: command.taskIds }),
          }),
        }),
      );
      return;
    }
    if (path === "/tasks/convert") {
      const command = parseClientRequest(ClientTaskConvertRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTaskAttentionMutationResponseSchema.parse(
          this.#human.createTask(actor, {
            basedOnRoomSeq: command.basedOnRoomSeq,
            ...(command.collaboratorIds === undefined
              ? {}
              : { collaboratorIds: command.collaboratorIds }),
            dependencyTaskIds: command.dependencyTaskIds,
            idempotencyKey: command.idempotencyKey,
            roomId: command.roomId,
            ...(command.reviewerIds === undefined
              ? {}
              : { reviewerIds: command.reviewerIds }),
            sourceMessageId: command.messageId,
            ...(command.assigneeId === undefined
              ? {}
              : { assigneeId: command.assigneeId }),
            ...(command.description === undefined
              ? {}
              : { description: command.description }),
          }),
        ),
      );
      return;
    }
    if (path === "/tasks/create") {
      const command = parseClientRequest(ClientTaskCreateRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTaskAttentionMutationResponseSchema.parse(
          this.#human.createTask(actor, {
            ...(command.collaboratorIds === undefined
              ? {}
              : { collaboratorIds: command.collaboratorIds }),
            dependencyTaskIds: command.dependencyTaskIds,
            idempotencyKey: command.idempotencyKey,
            roomId: command.roomId,
            ...(command.reviewerIds === undefined
              ? {}
              : { reviewerIds: command.reviewerIds }),
            title: command.title,
            ...(command.assigneeId === undefined
              ? {}
              : { assigneeId: command.assigneeId }),
            ...(command.basedOnRoomSeq === undefined
              ? {}
              : { basedOnRoomSeq: command.basedOnRoomSeq }),
            ...(command.description === undefined
              ? {}
              : { description: command.description }),
          }),
        ),
      );
      return;
    }
    if (path === "/tasks/assign") {
      const command = parseClientRequest(ClientTaskAssignRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTaskAttentionMutationResponseSchema.parse(
          this.#human.assignTask(actor, command),
        ),
      );
      return;
    }
    if (path === "/tasks/reassign") {
      const command = parseClientRequest(ClientTaskReassignRequestSchema, body);
      const administration = this.#requireTaskReassignmentAdministration();
      writeJson(
        response,
        200,
        ClientTaskReassignmentResponseSchema.parse(
          await administration.reassign(actor, command),
        ),
      );
      return;
    }
    if (path === "/tasks/unassign") {
      const command = parseClientRequest(ClientTaskUnassignRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTaskAttentionMutationResponseSchema.parse(
          this.#human.unassignTask(actor, command),
        ),
      );
      return;
    }
    if (path === "/tasks/unblock") {
      const command = parseClientRequest(ClientTaskUnblockRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTaskAttentionMutationResponseSchema.parse(
          this.#human.unblockTask(actor, command),
        ),
      );
      return;
    }
    if (path === "/tasks/cancel") {
      const command = parseClientRequest(ClientTaskCancelRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTaskAttentionMutationResponseSchema.parse(
          this.#human.cancelTask(actor, command),
        ),
      );
      return;
    }
    if (path === "/tasks/reopen") {
      const command = parseClientRequest(ClientTaskReopenRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTaskAttentionMutationResponseSchema.parse(
          this.#human.reopenTask(actor, command),
        ),
      );
      return;
    }
    if (path === "/tasks/workflow") {
      const command = parseClientRequest(
        ClientTaskWorkflowUpdateRequestSchema,
        body,
      );
      writeJson(
        response,
        200,
        ClientTaskAttentionMutationResponseSchema.parse(
          this.#human.updateTaskWorkflowStatus(actor, command),
        ),
      );
      return;
    }
    if (path === "/tasks/complete") {
      const command = parseClientRequest(ClientTaskCompleteRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTaskAttentionMutationResponseSchema.parse(
          this.#human.completeTask(actor, command),
        ),
      );
      return;
    }
    if (path === "/input-requests/list") {
      const command = parseClientRequest(
        ClientInputRequestsListRequestSchema,
        body,
      );
      const inputRequests = this.#human
        .listInputRequests(actor, { roomId: command.roomId })
        .filter(
          (inputRequest) =>
            command.state === undefined || inputRequest.state === command.state,
        );
      writeJson(
        response,
        200,
        ClientInputRequestsListResponseSchema.parse({ inputRequests }),
      );
      return;
    }

    const command = parseClientRequest(InputRequestResolveRequestSchema, body);
    writeJson(
      response,
      200,
      InputRequestResolveResponseSchema.parse(
        this.#human.resolveInputRequest(actor, command),
      ),
    );
  }

  #authenticate(request: IncomingMessage): ClientSession {
    const authorization = request.headers.authorization;
    if (
      authorization === undefined ||
      Array.isArray(authorization) ||
      !authorization.startsWith("Bearer ")
    ) {
      throw new HttpRequestError(
        "unauthenticated",
        "client authentication failed",
        401,
      );
    }
    const accessToken = authorization.slice("Bearer ".length);
    if (accessToken.length === 0) {
      throw new HttpRequestError(
        "unauthenticated",
        "client authentication failed",
        401,
      );
    }
    return {
      actor: this.#human.authenticateHumanAccessToken(accessToken),
      credentialHash: hashToken(accessToken),
    };
  }

  #deliveryKey(
    session: ClientSession,
    input: { consumerId: string; roomId: string },
  ): string {
    return JSON.stringify([
      session.credentialHash,
      input.roomId,
      input.consumerId,
    ]);
  }

  #rememberDeliveredCursor(key: string, cursor: number): void {
    let cursors = this.#deliveredCursors.get(key);
    if (cursors === undefined) {
      cursors = new Set<number>();
      this.#deliveredCursors.set(key, cursors);
    }
    cursors.add(cursor);
    while (cursors.size > MAX_DELIVERED_CURSORS_PER_CONSUMER) {
      const oldest = cursors.values().next().value as number | undefined;
      if (oldest === undefined) break;
      cursors.delete(oldest);
    }
  }

  #forgetAcknowledgedCursors(key: string, throughSeq: number): void {
    const cursors = this.#deliveredCursors.get(key);
    if (cursors === undefined) return;
    for (const cursor of cursors) {
      if (cursor <= throughSeq) cursors.delete(cursor);
    }
    if (cursors.size === 0) this.#deliveredCursors.delete(key);
  }

  #agentMemoryOwner(actor: AuthenticatedActorContext, agentId: string): string {
    return this.#human.getWorkspaceAgentManagementView(actor, agentId).agent
      .definition.participantId;
  }

  #requireAgentMemoryAdministration(): AgentMemoryAdministrationPort {
    if (this.#agentMemoryAdministration === undefined) {
      throw new HttpRequestError(
        "agent_memory_unavailable",
        "Agent Memory administration is unavailable on this Computer",
        503,
      );
    }
    return this.#agentMemoryAdministration;
  }

  #requireAgentExecutionAdministration(): AgentExecutionAdministrationPort {
    if (this.#agentExecutionAdministration === undefined) {
      throw new HttpRequestError(
        "agent_execution_reset_unavailable",
        "Agent execution reset is unavailable on this Computer",
        503,
      );
    }
    return this.#agentExecutionAdministration;
  }

  #requireTaskReassignmentAdministration(): TaskReassignmentAdministrationPort {
    if (this.#taskReassignmentAdministration === undefined) {
      throw new HttpRequestError(
        "task_reassignment_unavailable",
        "Safe Task reassignment is unavailable on this Computer",
        503,
      );
    }
    return this.#taskReassignmentAdministration;
  }

  #requireWebPushAdministration(): WebPushAdministrationPort {
    if (this.#webPushAdministration === undefined) {
      throw new HttpRequestError(
        "web_push_unavailable",
        "Web Push is unavailable on this Computer",
        503,
      );
    }
    return this.#webPushAdministration;
  }

  #writeError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error instanceof HttpRequestError) {
      writeJson(
        response,
        error.status,
        ClientErrorResponseSchema.parse({
          error: { code: error.code, message: error.message },
        }),
      );
      return;
    }
    if (error instanceof KernelError) {
      const status =
        error.code === "unauthenticated"
          ? 401
          : error.code === "forbidden"
            ? 403
            : error.code === "not_found"
              ? 404
              : 409;
      writeJson(
        response,
        status,
        ClientErrorResponseSchema.parse({
          error: { code: error.code, message: error.message },
        }),
      );
      return;
    }
    writeJson(
      response,
      500,
      ClientErrorResponseSchema.parse({
        error: { code: "internal_error", message: "internal server error" },
      }),
    );
  }
}

function resolveClientRoute(
  url: string | undefined,
): { apiVersion: 1 | 2 | 3; path: string } | undefined {
  if (url?.startsWith("/v1/client/") === true) {
    return { apiVersion: 1, path: url.slice("/v1/client".length) };
  }
  if (url?.startsWith("/v2/client/") === true) {
    return { apiVersion: 2, path: url.slice("/v2/client".length) };
  }
  if (url?.startsWith("/v3/client/") === true) {
    return { apiVersion: 3, path: url.slice("/v3/client".length) };
  }
  return undefined;
}

function systemNotifications(
  inventory: LocalRuntimeInventoryResponse,
): ReadonlyArray<{
  computerName: string;
  dismissible: true;
  kind: "computer_offline";
  lastSeenAt?: string;
  notificationId: string;
  target: { kind: "computer"; hostId: string };
}> {
  const computer = inventory.computer;
  if (computer?.status !== "offline") return [];
  const episode = [
    inventory.hostId,
    computer.instanceId ?? "unknown",
    computer.lastSeenAt ?? "unknown",
  ].join(":");
  return [
    {
      computerName: computer.displayName,
      dismissible: true,
      kind: "computer_offline",
      ...(computer.lastSeenAt === undefined
        ? {}
        : { lastSeenAt: computer.lastSeenAt }),
      notificationId: `computer-offline:${episode}`,
      target: { kind: "computer", hostId: inventory.hostId },
    },
  ];
}

async function stopRoomAgentsAfterTerminalProof(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  command: Parameters<HumanApplicationPort["requestRoomAgentSos"]>[1],
) {
  let result = human.requestRoomAgentSos(actor, command);
  if (result.operation.state !== "stopping") return result;
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      result = human.continueRoomAgentSos(actor, {
        operationId: result.operation.operationId,
      });
      return result;
    } catch (error) {
      if (!(error instanceof RuntimeTerminationProofError)) throw error;
      if (Date.now() >= deadline) {
        throw new RuntimeTerminationProofError(
          `Room Agent SOS ${result.operation.operationId} is still waiting for Host terminal proof`,
        );
      }
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
}

async function readJsonObject(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      throw new HttpRequestError(
        "body_too_large",
        "request body exceeds 1 MiB",
        413,
      );
    }
    chunks.push(buffer);
  }
  if (bytes === 0) return {};

  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
  } catch {
    throw new HttpRequestError("invalid_json", "body must be JSON", 400);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpRequestError(
      "invalid_body",
      "body must be a JSON object",
      400,
    );
  }
  return value as Record<string, unknown>;
}

type ProtocolSchema<T> = {
  safeParse(value: unknown):
    | { data: T; success: true }
    | {
        error: {
          issues: Array<{
            code: string;
            keys?: string[];
            message: string;
            path: PropertyKey[];
          }>;
        };
        success: false;
      };
};

function parseClientRequest<T>(
  schema: ProtocolSchema<T>,
  body: Record<string, unknown>,
): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  if (issue?.code === "unrecognized_keys") {
    const unexpected = issue.keys?.[0] ?? "unknown";
    throw new HttpRequestError(
      "unexpected_field",
      `field ${unexpected} is not accepted`,
      400,
    );
  }
  const field = issue?.path[0];
  throw new HttpRequestError(
    "invalid_field",
    `${typeof field === "string" ? field : "request"}: ${issue?.message ?? "invalid value"}`,
    400,
  );
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.statusCode = status;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function hashToken(accessToken: string): string {
  return createHash("sha256").update(accessToken, "utf8").digest("hex");
}
import {
  FILE_DATA_PATHS,
  routeFiles,
  transferFile,
} from "./client-file-routes.ts";

async function manageAgentAfterTerminalProof(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  command: Parameters<HumanApplicationPort["manageWorkspaceAgent"]>[1],
) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return human.manageWorkspaceAgent(actor, command);
    } catch (error) {
      if (
        command.action !== "set_state" ||
        command.state !== "tombstoned" ||
        !(error instanceof RuntimeTerminationProofError) ||
        Date.now() >= deadline
      )
        throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
}
