import {
  ClientAcknowledgeRequestSchema,
  ClientAcknowledgeResponseSchema,
  ClientAgentOnboardRequestSchema,
  ClientAgentProvisionRequestSchema,
  ClientAgentProvisionResponseSchema,
  ClientAgentsListRequestSchema,
  ClientAgentsListResponseSchema,
  ClientHealthResponseSchema,
  ClientInputRequestsListRequestSchema,
  ClientInputRequestsListResponseSchema,
  ClientMessageMutationResponseSchema,
  ClientMessagePostRequestSchema,
  ClientMessagesListRequestSchema,
  ClientMessagesListResponseSchema,
  ClientPrincipalMeRequestSchema,
  ClientPrincipalMeResponseSchema,
  ClientRoomSyncRequestSchema,
  ClientRoomSyncResponseSchema,
  ClientRoomCreateRequestSchema,
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
  ClientTaskCompleteRequestSchema,
  ClientTaskCreateRequestSchema,
  ClientTaskMutationResponseSchema,
  ClientTasksListRequestSchema,
  ClientTasksListResponseSchema,
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
  type ClientAcknowledgeRequest,
  type ClientAcknowledgeResponse,
  type ClientAgentOnboardRequest,
  type ClientAgentProvisionRequest,
  type ClientAgentProvisionResponse,
  type ClientAgentsListRequest,
  type ClientAgentsListResponse,
  type ClientHealthResponse,
  type ClientInputRequestsListRequest,
  type ClientInputRequestsListResponse,
  type ClientMessageMutationResponse,
  type ClientMessagePostRequest,
  type ClientMessagesListRequest,
  type ClientMessagesListResponse,
  type ClientPrincipalMeRequest,
  type ClientPrincipalMeResponse,
  type ClientRoomSyncRequest,
  type ClientRoomSyncResponse,
  type ClientRoomCreateRequest,
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
  type ClientTaskCompleteRequest,
  type ClientTaskCreateRequest,
  type ClientTaskMutationResponse,
  type ClientTasksListRequest,
  type ClientTasksListResponse,
  type ClientTaskUnblockRequest,
  type ClientThreadCreateRequest,
  type ClientThreadCreateResponse,
  type ClientThreadReplyRequest,
  type ClientThreadsListRequest,
  type ClientThreadsListResponse,
  type ClientWorkspacesListRequest,
  type ClientWorkspacesListResponse,
  type ClientWorkspaceCreateRequest,
  type ClientWorkspaceMutationResponse,
  type InputRequestResolveRequest,
  type InputRequestResolveResponse,
  type LocalRuntimeInventoryRequest,
  type LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";
import type { ZodType } from "zod";

export type RahClientOperationMap = {
  "agent.list": {
    input: ClientAgentsListRequest;
    output: ClientAgentsListResponse;
  };
  "agent.onboard": {
    input: ClientAgentOnboardRequest;
    output: ClientRoomMemberMutationResponse;
  };
  "agent.provision": {
    input: ClientAgentProvisionRequest;
    output: ClientAgentProvisionResponse;
  };
  health: {
    input: Record<string, never>;
    output: ClientHealthResponse;
  };
  "host.runtime.list": {
    input: LocalRuntimeInventoryRequest;
    output: LocalRuntimeInventoryResponse;
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
  "message.post": {
    input: ClientMessagePostRequest;
    output: ClientMessageMutationResponse;
  };
  "principal.me": {
    input: ClientPrincipalMeRequest;
    output: ClientPrincipalMeResponse;
  };
  "room.acknowledge": {
    input: ClientAcknowledgeRequest;
    output: ClientAcknowledgeResponse;
  };
  "room.create": {
    input: ClientRoomCreateRequest;
    output: ClientRoomMutationResponse;
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
  "task.complete": {
    input: ClientTaskCompleteRequest;
    output: ClientTaskMutationResponse;
  };
  "task.list": {
    input: ClientTasksListRequest;
    output: ClientTasksListResponse;
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
  "workspace.create": {
    input: ClientWorkspaceCreateRequest;
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
  "agent.list": {
    authenticated: true,
    input: ClientAgentsListRequestSchema,
    method: "POST",
    output: ClientAgentsListResponseSchema,
    path: "/v3/client/agents/list",
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
  "task.complete": {
    authenticated: true,
    input: ClientTaskCompleteRequestSchema,
    method: "POST",
    output: ClientTaskMutationResponseSchema,
    path: "/v3/client/tasks/complete",
  },
  "task.list": {
    authenticated: true,
    input: ClientTasksListRequestSchema,
    method: "POST",
    output: ClientTasksListResponseSchema,
    path: "/v3/client/tasks/list",
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
  "workspace.create": {
    authenticated: true,
    input: ClientWorkspaceCreateRequestSchema,
    method: "POST",
    output: ClientWorkspaceMutationResponseSchema,
    path: "/v3/client/workspaces/create",
  },
};

export const RAH_CLIENT_OPERATION_NAMES = Object.freeze(
  Object.keys(operationDefinitions).sort() as RahClientOperation[],
);

export interface RahClient {
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
  readonly #accessToken: () => string | undefined;
  readonly #baseUrl: string;
  readonly #fetch: RahFetch;

  constructor(options: {
    accessToken: () => string | undefined;
    baseUrl: string;
    fetch?: RahFetch;
  }) {
    this.#accessToken = options.accessToken;
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#fetch = options.fetch ?? defaultFetch;
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
    const payload = await response.json();
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
