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
    let stage = "工作进程响应";
    const stages: Record<string, string> = {
      received: "通知队列",
      clients: "页面状态读取",
      receipts: "去重记录读取",
      display: "系统显示",
      save: "显示回执保存",
    };
    const finish = (error?: Error) => {
      clearTimeout(timer);
      channel.port1.close();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(
      () => finish(Error(`系统通知结果未确认（${stage}）；未自动重发。`)),
      5000,
    );
    channel.port1.onmessage = (event) => {
      if (event.data?.stage) {
        stage = stages[event.data.stage] ?? "工作进程响应";
        return;
      }
      finish(
        event.data?.ok
          ? undefined
          : Error(
              event.data?.error === "source"
                ? "通知来源校验失败；未发送。"
                : "系统未接受通知，请检查权限。",
            ),
      );
    };
    try {
      registration.active!.postMessage({ type: "LOOM_LOCAL_NOTIFY", payload }, [
        channel.port2,
      ]);
    } catch (error) {
      channel.port2.close();
      finish(error instanceof Error ? error : Error("通知发送失败。"));
    }
  });
}
