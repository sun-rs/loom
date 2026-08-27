import { createHash } from "node:crypto";
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
} from "@rah-os/kernel";
import {
  ClientAcknowledgeRequestSchema,
  ClientAcknowledgeResponseSchema,
  ClientAgentOnboardRequestSchema,
  ClientAgentManageRequestSchema,
  ClientAgentManageResponseSchema,
  ClientAgentGetRequestSchema,
  ClientAgentGetResponseSchema,
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
  ClientMessageMutationResponseSchema,
  ClientMessagePostRequestSchema,
  ClientMessagesListRequestSchema,
  ClientMessagesListResponseSchema,
  ClientPrincipalMeRequestSchema,
  ClientPrincipalMeResponseSchema,
  ClientRoomMemberAddRequestSchema,
  ClientRoomMemberMutationResponseSchema,
  ClientRoomMemberRemoveRequestSchema,
  ClientRoomMemberRemoveResponseSchema,
  ClientRoomMemberRoleRequestSchema,
  ClientRoomAgentActivityListRequestSchema,
  ClientRoomAgentActivityListResponseSchema,
  ClientRoomMembersListRequestSchema,
  ClientRoomMembersListResponseSchema,
  ClientRoomCreateRequestSchema,
  ClientRoomMutationResponseSchema,
  ClientRoomsListRequestSchema,
  ClientRoomsListResponseSchema,
  ClientRoomSyncRequestSchema,
  ClientRoomSyncResponseSchema,
  ClientTasksListRequestSchema,
  ClientTasksListResponseSchema,
  ClientTaskAssignRequestSchema,
  ClientTaskAttentionMutationResponseSchema,
  ClientTaskCancelRequestSchema,
  ClientTaskCompleteRequestSchema,
  ClientTaskCreateRequestSchema,
  ClientTaskMutationResponseSchema,
  ClientTaskUnblockRequestSchema,
  ClientThreadCreateRequestSchema,
  ClientThreadCreateResponseSchema,
  ClientThreadReplyRequestSchema,
  ClientThreadsListRequestSchema,
  ClientThreadsListResponseSchema,
  ClientWorkspacesListRequestSchema,
  ClientWorkspacesListResponseSchema,
  ClientWorkspaceCreateRequestSchema,
  ClientWorkspaceMutationResponseSchema,
  InputRequestResolveRequestSchema,
  InputRequestResolveResponseSchema,
  LocalRuntimeInventoryRequestSchema,
  LocalRuntimeInventoryResponseSchema,
  type ClientHealthResponse,
  type LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";

export type ClientApplicationServiceOptions = {
  bindHost?: "127.0.0.1";
  health: () => ClientHealthResponse;
  human: HumanApplicationPort;
  localRuntimeInventory?: (
    actor: AuthenticatedActorContext,
  ) => LocalRuntimeInventoryResponse | Promise<LocalRuntimeInventoryResponse>;
  port?: number;
};

class HttpRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const MAX_BODY_BYTES = 64 * 1_024;
const CLIENT_V1_DATA_PATHS = new Set([
  "/input-requests/list",
  "/input-requests/resolve",
  "/rooms/acknowledge",
  "/rooms/sync",
  "/tasks/list",
  "/tasks/assign",
  "/tasks/cancel",
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
  ...CLIENT_V2_DATA_PATHS,
  "/agents/list",
  "/agents/get",
  "/agents/manage",
  "/agents/onboard",
  "/agents/provision",
  "/principals/me",
  "/rooms/agents/activity/list",
  "/rooms/create",
  "/workspaces/create",
]);
const MAX_DELIVERED_CURSORS_PER_CONSUMER = 1_024;

type ClientSession = {
  actor: AuthenticatedActorContext;
  credentialHash: string;
};

export class ClientApplicationService {
  readonly #bindHost: "127.0.0.1";
  readonly #health: () => ClientHealthResponse;
  readonly #human: HumanApplicationPort;
  readonly #localRuntimeInventory:
    | ((
        actor: AuthenticatedActorContext,
      ) =>
        LocalRuntimeInventoryResponse | Promise<LocalRuntimeInventoryResponse>)
    | undefined;
  readonly #port: number;
  readonly #deliveredCursors = new Map<string, Set<number>>();
  #origin: string | undefined;
  #server: Server | undefined;

  constructor(options: ClientApplicationServiceOptions) {
    this.#bindHost = options.bindHost ?? "127.0.0.1";
    this.#health = options.health;
    this.#human = options.human;
    this.#localRuntimeInventory = options.localRuntimeInventory;
    this.#port = options.port ?? 0;
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
    server.requestTimeout = 5_000;
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
      parseClientRequest(
        LocalRuntimeInventoryRequestSchema,
        await readJsonObject(request),
      );
      writeJson(
        response,
        200,
        LocalRuntimeInventoryResponseSchema.parse(
          await this.#localRuntimeInventory(actor),
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
    const body = await readJsonObject(request);
    const path = route.path;
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
    if (path === "/agents/list") {
      const command = parseClientRequest(ClientAgentsListRequestSchema, body);
      writeJson(
        response,
        200,
        ClientAgentsListResponseSchema.parse({
          agents: this.#human.listAgentCatalog(actor, {
            controlRoomId: command.controlRoomId,
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
          this.#human.getWorkspaceAgentManagementView(
            actor,
            command.agentDefinitionId,
          ),
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
          this.#human.manageWorkspaceAgent(actor, command),
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
    if (path === "/agents/provision") {
      const command = parseClientRequest(
        ClientAgentProvisionRequestSchema,
        body,
      );
      const { avatarKey, description, ...required } = command;
      writeJson(
        response,
        200,
        ClientAgentProvisionResponseSchema.parse(
          this.#human.provisionWorkspaceAgent(actor, {
            ...required,
            ...(avatarKey === undefined ? {} : { avatarKey }),
            ...(description === undefined ? {} : { description }),
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
            afterSeq: command.afterSeq,
            limit: command.limit,
            roomId: command.roomId,
            ...(command.threadId === undefined
              ? {}
              : { threadId: command.threadId }),
          }),
        ),
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
    if (path === "/tasks/list") {
      const command = parseClientRequest(ClientTasksListRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTasksListResponseSchema.parse({
          tasks: this.#human.listTasks(actor, command),
        }),
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
            dependencyTaskIds: command.dependencyTaskIds,
            idempotencyKey: command.idempotencyKey,
            roomId: command.roomId,
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
    if (path === "/tasks/complete") {
      const command = parseClientRequest(ClientTaskCompleteRequestSchema, body);
      writeJson(
        response,
        200,
        ClientTaskMutationResponseSchema.parse(
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
        "request body exceeds 64 KiB",
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
