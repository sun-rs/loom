import { randomUUID } from "node:crypto";
import type { AuthenticatedActorContext } from "@rah-os/core";
import type { WebPushAdministrationPort } from "@rah-os/application-service";
import {
  WebPushPayloadSchema,
  type ClientPushSubscription,
  type WebPushPayload,
} from "@rah-os/protocol";
import webPush from "web-push";

import type { WebPushTransport } from "./web-push-dispatcher.ts";
import type { WebPushStateStore } from "./web-push-state.ts";

export function createNodeWebPushTransport(input: {
  privateKey: string;
  publicKey: string;
}): WebPushTransport {
  return Object.freeze({
    async send(subscription: ClientPushSubscription, payload: WebPushPayload) {
      await webPush.sendNotification(subscription, JSON.stringify(payload), {
        TTL: 60 * 60,
        urgency: "normal",
        vapidDetails: {
          subject: "mailto:local@rah-os.invalid",
          privateKey: input.privateKey,
          publicKey: input.publicKey,
        },
      });
    },
  });
}

export function createWebPushAdministration(input: {
  hostId: string;
  state: WebPushStateStore;
  transport: WebPushTransport;
}): WebPushAdministrationPort {
  const principalId = (actor: AuthenticatedActorContext) => actor.principalId;
  return Object.freeze({
    async configuration(actor, request = {}) {
      const keys = await input.state.vapidKeys();
      const subscriptions = await input.state.list(principalId(actor));
      return {
        ...(request.endpoint
          ? {
              subscribed: subscriptions.some(
                (s) => s.endpoint === request.endpoint,
              ),
            }
          : {}),
        applicationServerKey: keys.publicKey,
        subscriptionCount: subscriptions.length,
        supported: true,
      };
    },
    async subscribe(actor, request) {
      const subscriptionCount = await input.state.put(
        principalId(actor),
        request.subscription,
      );
      return { subscribed: true as const, subscriptionCount };
    },
    async unsubscribe(actor, request) {
      await input.state.remove(principalId(actor), request.endpoint);
      return {
        subscribed: false as const,
        subscriptionCount: (await input.state.list(principalId(actor))).length,
      };
    },
    async test(actor, request) {
      const subscriptions = await input.state.list(principalId(actor));
      const notificationId = `push-test:${randomUUID()}`;
      const payload = WebPushPayloadSchema.parse({
        alwaysShow: true,
        body: "macOS / iOS PWA 通知链已连接。",
        notificationId,
        tag: notificationId,
        target: request.target ?? { kind: "computer", hostId: input.hostId },
        title: "RAH OS 通知测试",
        version: 1,
      });
      let delivered = 0;
      for (const subscription of subscriptions) {
        try {
          await input.transport.send(subscription, payload);
          delivered += 1;
        } catch (error) {
          const statusCode =
            typeof error === "object" && error && "statusCode" in error
              ? Number(error.statusCode)
              : undefined;
          if (statusCode === 404 || statusCode === 410) {
            await input.state.remove(principalId(actor), subscription.endpoint);
            continue;
          }
          throw error;
        }
      }
      return { delivered };
    },
  });
}
