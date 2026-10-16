import type { RahClient } from "@rah-os/client-sdk";
export function dismissSystemNotification(
  client: RahClient,
  workspaceId: string,
  notificationId: string,
  idempotencyKey: string,
) {
  return client.request("notification.dismiss", {
    workspaceId,
    notificationId,
    idempotencyKey,
  });
}
