import { readRoomTimeline } from "./room-timeline.ts";
import type { ClientRoomTimelineRequest } from "@rah-os/protocol";
import { RoleCatalog } from "./role-catalog.ts";
import { ChannelMemoryService } from "./channel-memory.ts";
import { TaskDeletionService } from "./task-deletion.ts";
import { TaskAmendmentService } from "./task-amendment.ts";
import type { DatabaseSync } from "node:sqlite";

import type {
  AuthenticatedActorContext,
  AuthenticatedWorkerExecutionContext,
} from "./auth.ts";
import { HumanActivity } from "./human-activity.ts";
import { HumanSidebar } from "./human-sidebar.ts";
import { HumanNavigation } from "./human-navigation.ts";
import { HumanPublicChannels } from "./public-channel.ts";
import { HumanProfiles } from "./human-profile.ts";
import { HumanTaskHistory } from "./human-task-history.ts";
import { HumanNotifications } from "./human-notifications.ts";
import { MessageSocial } from "./message-social.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { RoomAgentSosService } from "./room-agent-sos-service.ts";
import { TaskReassignmentService } from "./task-reassignment-service.ts";

/**
 * Compose Human-owned command services without teaching RoomKernel their
 * individual constructor wiring. Business authority remains in each service.
 */
export function createHumanCommandServices(options: {
  requireMemoryWorker?: (
    worker: AuthenticatedWorkerExecutionContext,
  ) => import("@rah-os/protocol").ActivationCredentialScope;
  requireWorker: (
    worker: AuthenticatedWorkerExecutionContext,
  ) => import("@rah-os/protocol").ActivationCredentialScope;
  assertFreshContext(roomId: string, actorId: string, seq: number): void;
  createId: (prefix: string) => string;
  database: DatabaseSync;
  events: RoomEventWriter;
  now: () => Date;
  requireActor: (actor: AuthenticatedActorContext) => string;
  transaction: <Result>(operation: () => Result) => Result;
  bindProfileImageReference: (
    actorId: string,
    avatarKey: string | undefined,
    intentId?: string,
  ) => void;
}) {
  const humanActivity = new HumanActivity(options.database);
  const context = {
    database: options.database,
    now: options.now,
    requireActor: options.requireActor,
    transaction: options.transaction,
  };
  return Object.freeze({
    roles: new RoleCatalog(options),
    memory: new ChannelMemoryService({
      ...options,
      requireWorker: options.requireMemoryWorker ?? options.requireWorker,
    }),
    followHumanThread: (
      actor: AuthenticatedActorContext,
      input: Parameters<HumanActivity["follow"]>[1],
    ) =>
      options.transaction(() =>
        humanActivity.follow(options.requireActor(actor), input),
      ),
    getHumanThreadFollowers: (
      actor: AuthenticatedActorContext,
      input: Parameters<HumanActivity["followers"]>[1],
    ) => humanActivity.followers(options.requireActor(actor), input),
    humanNavigation: new HumanNavigation(context),
    humanProfiles: new HumanProfiles(context),
    humanTaskHistory: new HumanTaskHistory(context),
    taskAmendments: new TaskAmendmentService(options),
    taskDeletions: new TaskDeletionService(options),
    publicChannels: new HumanPublicChannels({
      ...context,
      events: options.events,
    }),
    humanNotifications: new HumanNotifications({
      ...context,
      events: options.events,
    }),
    humanSidebar: new HumanSidebar(context),
    listRoomTimeline: (
      actor: AuthenticatedActorContext,
      input: ClientRoomTimelineRequest,
    ) => readRoomTimeline(options.database, options.requireActor(actor), input),
    listHumanActivity: (
      actor: AuthenticatedActorContext,
      input: Parameters<HumanActivity["list"]>[1],
    ) => humanActivity.list(options.requireActor(actor), input),
    markHumanActivity: (
      actor: AuthenticatedActorContext,
      input: Parameters<HumanActivity["mark"]>[1],
    ) =>
      options.transaction(() =>
        humanActivity.mark(options.requireActor(actor), input),
      ),
    messageSocial: new MessageSocial({
      ...context,
      events: options.events,
      requireWorker: options.requireWorker,
    }),
    removeHumanThreadAgentFollower: (
      actor: AuthenticatedActorContext,
      input: Parameters<HumanActivity["removeAgentFollower"]>[1],
    ) =>
      options.transaction(() => {
        const now = options.now();
        return humanActivity.removeAgentFollower(
          options.requireActor(actor),
          input,
          {
            undoExpiresAt: new Date(now.getTime() + 5_000).toISOString(),
            undoToken: options.createId("thread_follower_undo"),
            updatedAt: now.toISOString(),
          },
        );
      }),
    restoreHumanThreadAgentFollower: (
      actor: AuthenticatedActorContext,
      input: Parameters<HumanActivity["restoreAgentFollower"]>[1],
    ) =>
      options.transaction(() =>
        humanActivity.restoreAgentFollower(
          options.requireActor(actor),
          input,
          options.now().toISOString(),
        ),
      ),
    roomAgentSos: new RoomAgentSosService({
      ...context,
      createId: options.createId,
      events: options.events,
    }),
    taskReassignment: new TaskReassignmentService({
      ...context,
      createId: options.createId,
      events: options.events,
    }),
  });
}
