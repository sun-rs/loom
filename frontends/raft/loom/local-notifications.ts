import type { WebPushPayload } from "@rah-os/protocol";
import { ensureNotificationWorker } from "./push-client.ts";
export const localNotificationKey = (workspaceId: string) =>
  `loom.local-notifications:${workspaceId}`;
export function localNotificationsEnabled(workspaceId: string) {
  return localStorage.getItem(localNotificationKey(workspaceId)) === "on";
}
export function setLocalNotifications(workspaceId: string, enabled: boolean) {
  localStorage.setItem(
    localNotificationKey(workspaceId),
    enabled ? "on" : "off",
  );
  window.dispatchEvent(new Event("loom-local-notifications"));
}
export const supportsLocalNotifications = () =>
  window.isSecureContext &&
  "Notification" in window &&
  "serviceWorker" in navigator;
export async function showLocalNotification(payload: WebPushPayload) {
  const registration = await ensureNotificationWorker();
  if (!registration.active) throw Error("通知工作进程未就绪。");
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (error?: Error) => {
      clearTimeout(timer);
      channel.port1.close();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(
      () => finish(Error("系统通知结果未确认；未自动重发。")),
      5000,
    );
    channel.port1.onmessage = (event) =>
      finish(
        event.data?.ok ? undefined : Error("系统未接受通知，请检查权限。"),
      );
    registration.active!.postMessage({ type: "LOOM_LOCAL_NOTIFY", payload }, [
      channel.port2,
    ]);
  });
}
