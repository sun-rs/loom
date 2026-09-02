import type { DatabaseSync } from "node:sqlite";

import type { AuthenticatedActorContext } from "./auth.ts";
import { HumanSidebar } from "./human-sidebar.ts";
import { HumanNavigation } from "./human-navigation.ts";
import { HumanNotifications } from "./human-notifications.ts";
import { MessageSocial } from "./message-social.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { TaskReassignmentService } from "./task-reassignment-service.ts";

/**
 * Compose Human-owned command services without teaching RoomKernel their
 * individual constructor wiring. Business authority remains in each service.
 */
export function createHumanCommandServices(options: {
  createId: (prefix: string) => string;
  database: DatabaseSync;
  events: RoomEventWriter;
  now: () => Date;
  requireActor: (actor: AuthenticatedActorContext) => string;
  transaction: <Result>(operation: () => Result) => Result;
}) {
  const context = {
    database: options.database,
    now: options.now,
    requireActor: options.requireActor,
    transaction: options.transaction,
  };
  return Object.freeze({
    humanNavigation: new HumanNavigation(context),
    humanNotifications: new HumanNotifications({
      ...context,
      events: options.events,
    }),
    humanSidebar: new HumanSidebar(context),
    messageSocial: new MessageSocial({ ...context, events: options.events }),
    taskReassignment: new TaskReassignmentService({
      ...context,
      createId: options.createId,
      events: options.events,
    }),
  });
}
