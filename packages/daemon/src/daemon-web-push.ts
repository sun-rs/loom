import type { WebPushAdministrationPort } from "@rah-os/application-service";
import type { RoomKernel } from "@rah-os/core";

import {
  createNodeWebPushTransport,
  createWebPushAdministration,
} from "./web-push-administration.ts";
import { WebPushOutboxDispatcher } from "./web-push-dispatcher.ts";
import { WebPushStateStore } from "./web-push-state.ts";

export type DaemonWebPush = {
  administration: WebPushAdministrationPort;
  dispatcher: WebPushOutboxDispatcher;
};

/** Owns Web Push transport composition outside the daemon lifecycle root. */
export async function createDaemonWebPush(input: {
  host: { hostId: string; instanceId: string };
  kernel: RoomKernel;
  leaseMs: number;
  pollIntervalMs: number;
  retryAfterMs: number;
  stateDirectory: string;
}): Promise<DaemonWebPush> {
  const state = new WebPushStateStore({
    directory: input.stateDirectory,
  });
  const transport = createNodeWebPushTransport(await state.vapidKeys());
  return Object.freeze({
    administration: createWebPushAdministration({
      hostId: input.host.hostId,
      state,
      transport,
    }),
    dispatcher: new WebPushOutboxDispatcher({
      dispatcherId: `${input.host.hostId}:${input.host.instanceId}:web-push`,
      kernel: input.kernel,
      leaseMs: input.leaseMs,
      pollIntervalMs: input.pollIntervalMs,
      retryAfterMs: input.retryAfterMs,
      subscriptions: state,
      transport,
    }),
  });
}
