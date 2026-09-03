import type { RoomKernel } from "./room-kernel.ts";
import type { ManagedMcpService } from "./managed-mcp-service.ts";

export type HumanApplicationPort = Pick<
  RoomKernel,
  | "acknowledgeCursor"
  | "addRoomMember"
  | "archiveWorkspaceRoom"
  | "assignTask"
  | "authenticateHumanAccessToken"
  | "cancelTask"
  | "completeTask"
  | "createTask"
  | "createThread"
  | "createWorkspace"
  | "deleteWorkspaceRoom"
  | "updateWorkspace"
  | "getAuthenticatedPrincipal"
  | "updateAuthenticatedPrincipal"
  | "getWorkspaceAgentManagementView"
  | "listAgentActivity"
  | "listAgentTrajectory"
  | "listAgentPresence"
  | "listInputRequests"
  | "leaveRoom"
  | "listAgentCatalog"
  | "listMessages"
  | "listMessageForwardTargets"
  | "listRoomAgentActivity"
  | "listRoomMemberships"
  | "listRooms"
  | "listWorkspaceAgentRooms"
  | "listTasks"
  | "listGlobalTasks"
  | "searchWorkspace"
  | "getMessageContext"
  | "listHumanActivity"
  | "markHumanActivity"
  | "followHumanThread"
  | "getHumanThreadFollowers"
  | "listThreads"
  | "listWorkspaces"
  | "listWorkspaceMemberGraph"
  | "manageWorkspaceAgent"
  | "onboardAgentToRoom"
  | "openDirectRoom"
  | "forwardMessages"
  | "provisionWorkspaceAgent"
  | "removeRoomMember"
  | "removeHumanThreadAgentFollower"
  | "restoreHumanThreadAgentFollower"
  | "reopenTask"
  | "replyThread"
  | "resolveInputRequest"
  | "setRoomMemberRole"
  | "sync"
  | "unassignTask"
  | "unarchiveWorkspaceRoom"
  | "unblockTask"
  | "updateWorkspaceRoom"
  | "updateTaskWorkflowStatus"
> & {
  listMessageSocial: RoomKernel["messageSocial"]["list"];
  reactMessage: RoomKernel["messageSocial"]["react"];
  saveMessage: RoomKernel["messageSocial"]["save"];
  listSavedMessages: RoomKernel["messageSocial"]["saved"];
  getSidebarPreferences: RoomKernel["humanSidebar"]["get"];
  patchSidebarPreferences: RoomKernel["humanSidebar"]["patch"];
  resolveNavigationTarget: RoomKernel["humanNavigation"]["resolve"];
  listNotificationDismissals: RoomKernel["humanNotifications"]["listDismissals"];
  dismissNotification: RoomKernel["humanNotifications"]["dismiss"];
  requestRoomAgentSos: RoomKernel["roomAgentSos"]["requestStop"];
  continueRoomAgentSos: RoomKernel["roomAgentSos"]["continueStop"];
  resumeRoomAgentSos: RoomKernel["roomAgentSos"]["resume"];
  listAgentReminders: RoomKernel["reminders"]["listHuman"];
  prepareFile: RoomKernel["files"]["prepare"];
  uploadFile: RoomKernel["files"]["upload"];
  cancelFile: RoomKernel["files"]["cancel"];
  listRoomFiles: RoomKernel["files"]["list"];
  downloadFile: RoomKernel["files"]["download"];
  assignManagedMcpServer: ManagedMcpService["assignServer"];
  createManagedMcpServer: ManagedMcpService["createServer"];
  createRoom: RoomKernel["createWorkspaceRoom"];
  listManagedMcpAssignments: ManagedMcpService["listAssignments"];
  listManagedMcpServers: ManagedMcpService["listServers"];
  listManagedMcpUsage: ManagedMcpService["listUsage"];
  listTaskReviews: RoomKernel["taskReviews"]["listRoomReviews"];
  listTaskSubmissions: RoomKernel["taskReviews"]["listRoomSubmissions"];
  requestTaskReassignment: RoomKernel["taskReassignment"]["request"];
  continueTaskReassignment: RoomKernel["taskReassignment"]["continue"];
  postRoomMessage: RoomKernel["postRoomMessage"];
  reviseManagedMcpAssignment: ManagedMcpService["reviseAssignment"];
  reviseManagedMcpServer: ManagedMcpService["reviseServer"];
  setManagedMcpAssignmentState: ManagedMcpService["setAssignmentState"];
  setManagedMcpServerState: ManagedMcpService["setServerState"];
};

export function createHumanApplicationPort(
  kernel: RoomKernel,
): HumanApplicationPort {
  const port: HumanApplicationPort = {
    listMessageSocial: (actor, input) =>
      kernel.messageSocial.list(actor, input),
    reactMessage: (actor, input) => kernel.messageSocial.react(actor, input),
    saveMessage: (actor, input) => kernel.messageSocial.save(actor, input),
    listSavedMessages: (actor, input) =>
      kernel.messageSocial.saved(actor, input),
    getSidebarPreferences: (actor, input) =>
      kernel.humanSidebar.get(actor, input),
    patchSidebarPreferences: (actor, input) =>
      kernel.humanSidebar.patch(actor, input),
    resolveNavigationTarget: (actor, input) =>
      kernel.humanNavigation.resolve(actor, input),
    listNotificationDismissals: (actor, input) =>
      kernel.humanNotifications.listDismissals(actor, input),
    dismissNotification: (actor, input) =>
      kernel.humanNotifications.dismiss(actor, input),
    requestRoomAgentSos: (actor, input) =>
      kernel.roomAgentSos.requestStop(actor, input),
    continueRoomAgentSos: (actor, input) =>
      kernel.roomAgentSos.continueStop(actor, input),
    resumeRoomAgentSos: (actor, input) =>
      kernel.roomAgentSos.resume(actor, input),
    listAgentReminders: (actor, input) =>
      kernel.reminders.listHuman(actor, input),
    prepareFile: (actor, input) => kernel.files.prepare(actor, input),
    uploadFile: (actor, id, chunks) => kernel.files.upload(actor, id, chunks),
    cancelFile: (actor, input) => kernel.files.cancel(actor, input),
    listRoomFiles: (actor, input) => kernel.files.list(actor, input),
    downloadFile: (actor, id, range) => kernel.files.download(actor, id, range),
    acknowledgeCursor: (actor, input) => kernel.acknowledgeCursor(actor, input),
    addRoomMember: (actor, input) => kernel.addRoomMember(actor, input),
    archiveWorkspaceRoom: (actor, input) =>
      kernel.archiveWorkspaceRoom(actor, input),
    assignTask: (actor, input) => kernel.assignTask(actor, input),
    assignManagedMcpServer: (actor, input) =>
      kernel.managedMcp.assignServer(actor, input),
    authenticateHumanAccessToken: (accessToken) =>
      kernel.authenticateHumanAccessToken(accessToken),
    cancelTask: (actor, input) => kernel.cancelTask(actor, input),
    completeTask: (actor, input) => kernel.completeTask(actor, input),
    createRoom: (actor, input) => kernel.createWorkspaceRoom(actor, input),
    createManagedMcpServer: (actor, input) =>
      kernel.managedMcp.createServer(actor, input),
    createTask: (actor, input) => kernel.createTask(actor, input),
    createThread: (actor, input) => kernel.createThread(actor, input),
    createWorkspace: (actor, input) => kernel.createWorkspace(actor, input),
    deleteWorkspaceRoom: (actor, input) =>
      kernel.deleteWorkspaceRoom(actor, input),
    updateWorkspace: (actor, input) => kernel.updateWorkspace(actor, input),
    getAuthenticatedPrincipal: (actor) =>
      kernel.getAuthenticatedPrincipal(actor),
    updateAuthenticatedPrincipal: (actor, input) =>
      kernel.updateAuthenticatedPrincipal(actor, input),
    getWorkspaceAgentManagementView: (actor, agentDefinitionId) =>
      kernel.getWorkspaceAgentManagementView(actor, agentDefinitionId),
    listAgentActivity: (actor, input) => kernel.listAgentActivity(actor, input),
    listAgentTrajectory: (actor, input) =>
      kernel.listAgentTrajectory(actor, input),
    listAgentPresence: (actor, input) => kernel.listAgentPresence(actor, input),
    listAgentCatalog: (actor, input) => kernel.listAgentCatalog(actor, input),
    listInputRequests: (actor, input) => kernel.listInputRequests(actor, input),
    leaveRoom: (actor, input) => kernel.leaveRoom(actor, input),
    listManagedMcpAssignments: (actor, input) =>
      kernel.managedMcp.listAssignments(actor, input),
    listManagedMcpServers: (actor, input) =>
      kernel.managedMcp.listServers(actor, input),
    listManagedMcpUsage: (actor, input) =>
      kernel.managedMcp.listUsage(actor, input),
    listMessages: (actor, input) => kernel.listMessages(actor, input),
    listMessageForwardTargets: (actor, input) =>
      kernel.listMessageForwardTargets(actor, input),
    listRoomAgentActivity: (actor, input) =>
      kernel.listRoomAgentActivity(actor, input),
    listRoomMemberships: (actor, input) =>
      kernel.listRoomMemberships(actor, input),
    listRooms: (actor, input) => kernel.listRooms(actor, input),
    listWorkspaceAgentRooms: (actor, input) =>
      kernel.listWorkspaceAgentRooms(actor, input),
    listTasks: (actor, input) => kernel.listTasks(actor, input),
    listGlobalTasks: (actor, input) => kernel.listGlobalTasks(actor, input),
    searchWorkspace: (actor, input) => kernel.searchWorkspace(actor, input),
    getMessageContext: (actor, input) => kernel.getMessageContext(actor, input),
    listHumanActivity: (actor, input) => kernel.listHumanActivity(actor, input),
    markHumanActivity: (actor, input) => kernel.markHumanActivity(actor, input),
    followHumanThread: (actor, input) => kernel.followHumanThread(actor, input),
    getHumanThreadFollowers: (actor, input) =>
      kernel.getHumanThreadFollowers(actor, input),
    removeHumanThreadAgentFollower: (actor, input) =>
      kernel.removeHumanThreadAgentFollower(actor, input),
    restoreHumanThreadAgentFollower: (actor, input) =>
      kernel.restoreHumanThreadAgentFollower(actor, input),
    listTaskReviews: (actor, input) =>
      kernel.taskReviews.listRoomReviews(actor, input),
    listTaskSubmissions: (actor, input) =>
      kernel.taskReviews.listRoomSubmissions(actor, input),
    listThreads: (actor, input) => kernel.listThreads(actor, input),
    listWorkspaces: (actor) => kernel.listWorkspaces(actor),
    listWorkspaceMemberGraph: (actor, input) =>
      kernel.listWorkspaceMemberGraph(actor, input),
    manageWorkspaceAgent: (actor, input) =>
      kernel.manageWorkspaceAgent(actor, input),
    onboardAgentToRoom: (actor, input) =>
      kernel.onboardAgentToRoom(actor, input),
    openDirectRoom: (actor, input) => kernel.openDirectRoom(actor, input),
    forwardMessages: (actor, input) => kernel.forwardMessages(actor, input),
    provisionWorkspaceAgent: (actor, input) =>
      kernel.provisionWorkspaceAgent(actor, input),
    postRoomMessage: (actor, input) => kernel.postRoomMessage(actor, input),
    removeRoomMember: (actor, input) => kernel.removeRoomMember(actor, input),
    requestTaskReassignment: (actor, input) =>
      kernel.taskReassignment.request(actor, input),
    continueTaskReassignment: (actor, input) =>
      kernel.taskReassignment.continue(actor, input),
    reopenTask: (actor, input) => kernel.reopenTask(actor, input),
    reviseManagedMcpAssignment: (actor, input) =>
      kernel.managedMcp.reviseAssignment(actor, input),
    reviseManagedMcpServer: (actor, input) =>
      kernel.managedMcp.reviseServer(actor, input),
    replyThread: (actor, input) => kernel.replyThread(actor, input),
    resolveInputRequest: (actor, input) =>
      kernel.resolveInputRequest(actor, input),
    setRoomMemberRole: (actor, input) => kernel.setRoomMemberRole(actor, input),
    setManagedMcpAssignmentState: (actor, input) =>
      kernel.managedMcp.setAssignmentState(actor, input),
    setManagedMcpServerState: (actor, input) =>
      kernel.managedMcp.setServerState(actor, input),
    sync: (actor, input) => kernel.sync(actor, input),
    unassignTask: (actor, input) => kernel.unassignTask(actor, input),
    unarchiveWorkspaceRoom: (actor, input) =>
      kernel.unarchiveWorkspaceRoom(actor, input),
    unblockTask: (actor, input) => kernel.unblockTask(actor, input),
    updateWorkspaceRoom: (actor, input) =>
      kernel.updateWorkspaceRoom(actor, input),
    updateTaskWorkflowStatus: (actor, input) =>
      kernel.updateTaskWorkflowStatus(actor, input),
  };
  return Object.freeze(port);
}
