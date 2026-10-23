import type { RoomKernel } from "./room-kernel.ts";

export type HumanApplicationPort = Pick<
  RoomKernel,
  | "acknowledgeCursor"
  | "addRoomMember"
  | "getSystemChannelVisibility"
  | "updateSystemChannelVisibility"
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
  | "getAgentDeletionDiagnostics"
  | "getAuthenticatedPrincipal"
  | "getTask"
  | "updateAuthenticatedPrincipal"
  | "getWorkspaceAgentManagementView"
  | "listAgentActivity"
  | "listAgentTrajectory"
  | "listAgentPresence"
  | "listInputRequests"
  | "leaveRoom"
  | "listAgentCatalog"
  | "listRoomTimeline"
  | "listMessages"
  | "listMessageReferenceReadStates"
  | "listMessageForwardTargets"
  | "listRoomAgentActivity"
  | "listRoomMemberships"
  | "listRooms"
  | "listWorkspaceAgentRooms"
  | "listTasks"
  | "listTaskPage"
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
  | "openDirectRoom"
  | "forwardMessages"
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
  restoreRole: RoomKernel["roles"]["restore"];
  deleteRole: RoomKernel["roles"]["delete"];
  reviseRole: RoomKernel["roles"]["revise"];
  createRole: RoomKernel["roles"]["create"];
  listRoles: RoomKernel["roles"]["list"];
  instantiateRole: RoomKernel["roles"]["instantiate"];
  resetInstanceSession: RoomKernel["roles"]["resetInstanceSession"];
  abandonBlockedActivation: RoomKernel["roles"]["abandonBlockedActivation"];
  listChannelMemory: RoomKernel["memory"]["humanList"];
  readChannelMemory: RoomKernel["memory"]["humanRead"];
  searchChannelMemory: RoomKernel["memory"]["humanSearch"];
  getChannelMemoryHistory: RoomKernel["memory"]["humanHistory"];
  invalidateChannelMemory: RoomKernel["memory"]["humanInvalidate"];
  restoreChannelMemory: RoomKernel["memory"]["humanRestore"];
  deleteChannelMemory: RoomKernel["memory"]["humanDelete"];
  updateChannelMemory: RoomKernel["memory"]["humanUpdate"];
  pinChannelMemory: RoomKernel["memory"]["humanPin"];
  importLegacyChannelMemory: RoomKernel["memory"]["humanImportLegacy"];
  authorizeLegacyChannelMemoryImport: RoomKernel["memory"]["humanAuthorizeImportLegacy"];
  getChannelMemoryPolicy: RoomKernel["memory"]["readPolicy"];
  updateChannelMemoryPolicy: RoomKernel["memory"]["updatePolicy"];
  listMessageSocial: RoomKernel["messageSocial"]["list"];
  reactMessage: RoomKernel["messageSocial"]["react"];
  saveMessage: RoomKernel["messageSocial"]["save"];
  listSavedMessages: RoomKernel["messageSocial"]["saved"];
  getSidebarPreferences: RoomKernel["humanSidebar"]["get"];
  patchSidebarPreferences: RoomKernel["humanSidebar"]["patch"];
  resolveNavigationTarget: RoomKernel["humanNavigation"]["resolve"];
  previewChannel: RoomKernel["publicChannels"]["preview"];
  discoverPublicChannels: RoomKernel["publicChannels"]["list"];
  joinPublicChannel: RoomKernel["publicChannels"]["join"];
  getHumanProfile: RoomKernel["humanProfiles"]["get"];
  amendTask: RoomKernel["taskAmendments"]["human"];
  deleteTask: RoomKernel["taskDeletions"]["human"];
  listTaskHistory: RoomKernel["humanTaskHistory"]["list"];
  listWorkspaceHumans: RoomKernel["humanProfiles"]["list"];
  listLocalNotifications: RoomKernel["humanNotifications"]["local"];
  listNotificationDismissals: RoomKernel["humanNotifications"]["listDismissals"];
  dismissNotification: RoomKernel["humanNotifications"]["dismiss"];
  requestRoomAgentSos: RoomKernel["roomAgentSos"]["requestStop"];
  continueRoomAgentSos: RoomKernel["roomAgentSos"]["continueStop"];
  resumeRoomAgentSos: RoomKernel["roomAgentSos"]["resume"];
  readRoomExecution: RoomKernel["roomAgentSos"]["read"];
  listAgentReminders: RoomKernel["reminders"]["listHuman"];
  listAttachmentComments: RoomKernel["attachmentComments"]["list"];
  postAttachmentComment: RoomKernel["attachmentComments"]["post"];
  prepareFile: RoomKernel["files"]["prepare"];
  uploadFile: RoomKernel["files"]["upload"];
  cancelFile: RoomKernel["files"]["cancel"];
  listRoomFiles: RoomKernel["files"]["list"];
  downloadFile: RoomKernel["files"]["download"];

  createRoom: RoomKernel["createWorkspaceRoom"];

  getRunAttemptUsage: RoomKernel["runAttemptUsage"]["get"];
  getUsageSummary: RoomKernel["runAttemptUsage"]["summary"];
  listTaskReviews: RoomKernel["taskReviews"]["listRoomReviews"];
  listTaskSubmissions: RoomKernel["taskReviews"]["listRoomSubmissions"];
  requestTaskReassignment: RoomKernel["taskReassignment"]["request"];
  continueTaskReassignment: RoomKernel["taskReassignment"]["continue"];
  postRoomMessage: RoomKernel["postRoomMessage"];
};

export function createHumanApplicationPort(
  kernel: RoomKernel,
): HumanApplicationPort {
  const port: HumanApplicationPort = {
    restoreRole: (actor, input) => kernel.roles.restore(actor, input),
    deleteRole: (actor, input) => kernel.roles.delete(actor, input),
    reviseRole: (actor, input) => kernel.roles.revise(actor, input),
    createRole: (actor, input) => kernel.roles.create(actor, input),
    listRoles: (actor, input) => kernel.roles.list(actor, input),
    instantiateRole: (actor, input) => kernel.roles.instantiate(actor, input),
    resetInstanceSession: (actor, input) =>
      kernel.roles.resetInstanceSession(actor, input),
    abandonBlockedActivation: (actor, input) =>
      kernel.roles.abandonBlockedActivation(actor, input),
    listChannelMemory: (actor, input) => kernel.memory.humanList(actor, input),
    readChannelMemory: (actor, input) => kernel.memory.humanRead(actor, input),
    searchChannelMemory: (actor, input) =>
      kernel.memory.humanSearch(actor, input),
    getChannelMemoryHistory: (actor, input) =>
      kernel.memory.humanHistory(actor, input),
    invalidateChannelMemory: (actor, input) =>
      kernel.memory.humanInvalidate(actor, input),
    restoreChannelMemory: (actor, input) =>
      kernel.memory.humanRestore(actor, input),
    deleteChannelMemory: (actor, input) =>
      kernel.memory.humanDelete(actor, input),
    updateChannelMemory: (actor, input) =>
      kernel.memory.humanUpdate(actor, input),
    pinChannelMemory: (actor, input) => kernel.memory.humanPin(actor, input),
    importLegacyChannelMemory: (actor, input, files) =>
      kernel.memory.humanImportLegacy(actor, input, files),
    authorizeLegacyChannelMemoryImport: (actor, input) =>
      kernel.memory.humanAuthorizeImportLegacy(actor, input),
    getChannelMemoryPolicy: (actor, input) =>
      kernel.memory.readPolicy(actor, input),
    updateChannelMemoryPolicy: (actor, input) =>
      kernel.memory.updatePolicy(actor, input),
    previewChannel: (actor, input) =>
      kernel.publicChannels.preview(actor, input),
    discoverPublicChannels: (actor, input) =>
      kernel.publicChannels.list(actor, input),
    joinPublicChannel: (actor, input) =>
      kernel.publicChannels.join(actor, input),
    getHumanProfile: (actor, input) => kernel.humanProfiles.get(actor, input),
    listWorkspaceHumans: (actor, input) =>
      kernel.humanProfiles.list(actor, input),
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
    listLocalNotifications: (actor, input) =>
      kernel.humanNotifications.local(actor, input),
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
    readRoomExecution: (actor, input) => kernel.roomAgentSos.read(actor, input),
    listAgentReminders: (actor, input) =>
      kernel.reminders.listHuman(actor, input),
    listAttachmentComments: (actor, input) =>
      kernel.attachmentComments.list(actor, input),
    postAttachmentComment: (actor, input) =>
      kernel.attachmentComments.post(actor, input),
    prepareFile: (actor, input) => kernel.files.prepare(actor, input),
    uploadFile: (actor, id, chunks) => kernel.files.upload(actor, id, chunks),
    cancelFile: (actor, input) => kernel.files.cancel(actor, input),
    listRoomFiles: (actor, input) => kernel.files.list(actor, input),
    downloadFile: (actor, id, range) => kernel.files.download(actor, id, range),
    acknowledgeCursor: (actor, input) => kernel.acknowledgeCursor(actor, input),
    addRoomMember: (actor, input) => kernel.addRoomMember(actor, input),
    getSystemChannelVisibility: (actor, input) =>
      kernel.getSystemChannelVisibility(actor, input),
    updateSystemChannelVisibility: (actor, input) =>
      kernel.updateSystemChannelVisibility(actor, input),
    archiveWorkspaceRoom: (actor, input) =>
      kernel.archiveWorkspaceRoom(actor, input),
    assignTask: (actor, input) => kernel.assignTask(actor, input),

    authenticateHumanAccessToken: (accessToken) =>
      kernel.authenticateHumanAccessToken(accessToken),
    cancelTask: (actor, input) => kernel.cancelTask(actor, input),
    completeTask: (actor, input) => kernel.completeTask(actor, input),
    createRoom: (actor, input) => kernel.createWorkspaceRoom(actor, input),

    createTask: (actor, input) => kernel.createTask(actor, input),
    createThread: (actor, input) => kernel.createThread(actor, input),
    createWorkspace: (actor, input) => kernel.createWorkspace(actor, input),
    deleteWorkspaceRoom: (actor, input) =>
      kernel.deleteWorkspaceRoom(actor, input),
    updateWorkspace: (actor, input) => kernel.updateWorkspace(actor, input),
    getAgentDeletionDiagnostics: (actor, input) =>
      kernel.getAgentDeletionDiagnostics(actor, input),
    getAuthenticatedPrincipal: (actor) =>
      kernel.getAuthenticatedPrincipal(actor),
    getTask: (actor, input) => kernel.getTask(actor, input),
    amendTask: (actor, input) => kernel.taskAmendments.human(actor, input),
    deleteTask: (actor, input) => kernel.taskDeletions.human(actor, input),
    listTaskHistory: (actor, input) =>
      kernel.humanTaskHistory.list(actor, input),
    updateAuthenticatedPrincipal: (actor, input) =>
      kernel.updateAuthenticatedPrincipal(actor, input),
    getWorkspaceAgentManagementView: (actor, agentId) =>
      kernel.getWorkspaceAgentManagementView(actor, agentId),
    listAgentActivity: (actor, input) => kernel.listAgentActivity(actor, input),
    listAgentTrajectory: (actor, input) =>
      kernel.listAgentTrajectory(actor, input),
    getRunAttemptUsage: (actor, input) =>
      kernel.runAttemptUsage.get(actor, input),
    getUsageSummary: (actor, input) =>
      kernel.runAttemptUsage.summary(actor, input),
    listAgentPresence: (actor, input) => kernel.listAgentPresence(actor, input),
    listAgentCatalog: (actor, input) => kernel.listAgentCatalog(actor, input),
    listInputRequests: (actor, input) => kernel.listInputRequests(actor, input),
    leaveRoom: (actor, input) => kernel.leaveRoom(actor, input),

    listRoomTimeline: (actor, input) => kernel.listRoomTimeline(actor, input),
    listMessages: (actor, input) => kernel.listMessages(actor, input),
    listMessageReferenceReadStates: (actor, input) =>
      kernel.listMessageReferenceReadStates(actor, input),
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
    listTaskPage: (actor, input) => kernel.listTaskPage(actor, input),
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
    openDirectRoom: (actor, input) => kernel.openDirectRoom(actor, input),
    forwardMessages: (actor, input) => kernel.forwardMessages(actor, input),
    postRoomMessage: (actor, input) => kernel.postRoomMessage(actor, input),
    removeRoomMember: (actor, input) => kernel.removeRoomMember(actor, input),
    requestTaskReassignment: (actor, input) =>
      kernel.taskReassignment.request(actor, input),
    continueTaskReassignment: (actor, input) =>
      kernel.taskReassignment.continue(actor, input),
    reopenTask: (actor, input) => kernel.reopenTask(actor, input),

    replyThread: (actor, input) => kernel.replyThread(actor, input),
    resolveInputRequest: (actor, input) =>
      kernel.resolveInputRequest(actor, input),
    setRoomMemberRole: (actor, input) => kernel.setRoomMemberRole(actor, input),

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
