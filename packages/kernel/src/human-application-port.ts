import type { RoomKernel } from "./room-kernel.ts";

export type HumanApplicationPort = Pick<
  RoomKernel,
  | "acknowledgeCursor"
  | "addRoomMember"
  | "assignTask"
  | "authenticateHumanAccessToken"
  | "cancelTask"
  | "completeTask"
  | "createTask"
  | "createThread"
  | "createWorkspace"
  | "getAuthenticatedPrincipal"
  | "listInputRequests"
  | "listAgentCatalog"
  | "listMessages"
  | "listRoomAgentActivity"
  | "listRoomMemberships"
  | "listRooms"
  | "listTasks"
  | "listThreads"
  | "listWorkspaces"
  | "onboardAgentToRoom"
  | "provisionWorkspaceAgent"
  | "removeRoomMember"
  | "replyThread"
  | "resolveInputRequest"
  | "setRoomMemberRole"
  | "sync"
  | "unblockTask"
> & {
  createRoom: RoomKernel["createWorkspaceRoom"];
  postRoomMessage: RoomKernel["postRoomMessage"];
};

export function createHumanApplicationPort(
  kernel: RoomKernel,
): HumanApplicationPort {
  const port: HumanApplicationPort = {
    acknowledgeCursor: (actor, input) => kernel.acknowledgeCursor(actor, input),
    addRoomMember: (actor, input) => kernel.addRoomMember(actor, input),
    assignTask: (actor, input) => kernel.assignTask(actor, input),
    authenticateHumanAccessToken: (accessToken) =>
      kernel.authenticateHumanAccessToken(accessToken),
    cancelTask: (actor, input) => kernel.cancelTask(actor, input),
    completeTask: (actor, input) => kernel.completeTask(actor, input),
    createRoom: (actor, input) => kernel.createWorkspaceRoom(actor, input),
    createTask: (actor, input) => kernel.createTask(actor, input),
    createThread: (actor, input) => kernel.createThread(actor, input),
    createWorkspace: (actor, input) => kernel.createWorkspace(actor, input),
    getAuthenticatedPrincipal: (actor) =>
      kernel.getAuthenticatedPrincipal(actor),
    listAgentCatalog: (actor, input) => kernel.listAgentCatalog(actor, input),
    listInputRequests: (actor, input) => kernel.listInputRequests(actor, input),
    listMessages: (actor, input) => kernel.listMessages(actor, input),
    listRoomAgentActivity: (actor, input) =>
      kernel.listRoomAgentActivity(actor, input),
    listRoomMemberships: (actor, input) =>
      kernel.listRoomMemberships(actor, input),
    listRooms: (actor, input) => kernel.listRooms(actor, input),
    listTasks: (actor, input) => kernel.listTasks(actor, input),
    listThreads: (actor, input) => kernel.listThreads(actor, input),
    listWorkspaces: (actor) => kernel.listWorkspaces(actor),
    onboardAgentToRoom: (actor, input) =>
      kernel.onboardAgentToRoom(actor, input),
    provisionWorkspaceAgent: (actor, input) =>
      kernel.provisionWorkspaceAgent(actor, input),
    postRoomMessage: (actor, input) => kernel.postRoomMessage(actor, input),
    removeRoomMember: (actor, input) => kernel.removeRoomMember(actor, input),
    replyThread: (actor, input) => kernel.replyThread(actor, input),
    resolveInputRequest: (actor, input) =>
      kernel.resolveInputRequest(actor, input),
    setRoomMemberRole: (actor, input) => kernel.setRoomMemberRole(actor, input),
    sync: (actor, input) => kernel.sync(actor, input),
    unblockTask: (actor, input) => kernel.unblockTask(actor, input),
  };
  return Object.freeze(port);
}
