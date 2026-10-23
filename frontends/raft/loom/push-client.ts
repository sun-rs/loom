import type { RahClient } from "@rah-os/client-sdk";
import { ClientPushSubscriptionSchema } from "@rah-os/protocol";
export interface PushPlatform {
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  existing(): Promise<PushSubscription | null>;
  subscribe(key: string): Promise<PushSubscription>;
}
/** Native browser subscription is device state; daemon remains transport-registration owner. */
export class LoomPushClient {
  private client: RahClient;
  private platform: PushPlatform;
  constructor(client: RahClient, platform: PushPlatform) {
    this.client = client;
    this.platform = platform;
  }
  async read() {
    const subscription = await this.platform.existing();
    const config = await this.client.request(
      "push.configuration",
      subscription ? { endpoint: subscription.endpoint } : {},
    );
    if (subscription && config.subscribed === undefined)
      throw Error("通知服务尚不支持本浏览器订阅核实。");
    return {
      ...config,
      subscription,
      subscribed: !!subscription && config.subscribed === true,
    };
  }
  async enable() {
    // Called from an explicit pointer gesture; no async probe before the native permission prompt.
    const permission =
      this.platform.permission() === "granted"
        ? "granted"
        : await this.platform.requestPermission();
    if (permission !== "granted")
      throw Error("尚未获得通知权限，请在浏览器设置中允许通知。");
    const config = await this.client.request("push.configuration", {});
    if (!config.supported) throw Error("通知服务未配置。");
    const subscription = await this.platform.subscribe(
      config.applicationServerKey,
    );
    const browserValue = subscription.toJSON();
    const json = ClientPushSubscriptionSchema.parse({
      endpoint: browserValue.endpoint,
      keys: {
        auth: browserValue.keys?.auth,
        p256dh: browserValue.keys?.p256dh,
      },
    });
    try {
      await this.client.request("push.subscribe", { subscription: json });
    } catch {
      const status = await this.client.request("push.configuration", {
        endpoint: subscription.endpoint,
      });
      if (status.subscribed !== true)
        throw Error("启用结果未确认；未自动重发，请重新读取状态。");
    }
    return await this.read();
  }
  async disable() {
    const subscription = await this.platform.existing();
    if (!subscription) return await this.read();
    try {
      await this.client.request("push.unsubscribe", {
        endpoint: subscription.endpoint,
      });
    } catch {
      const status = await this.client.request("push.configuration", {
        endpoint: subscription.endpoint,
      });
      if (status.subscribed !== false)
        throw Error("停用结果未确认；保留浏览器端点供重新核实，未自动重发。");
    }
    if (!(await subscription.unsubscribe()))
      throw Error("服务端已停用，但浏览器订阅尚未清理，请重试停用。");
    return await this.read();
  }
  async test() {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.client.request("push.test", {}, { signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = new DOMException(
              "Push test deadline exceeded",
              "TimeoutError",
            );
            reject(error);
            controller.abort(error);
          }, 20000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
/** Structural port of official pushNotifications.ts registration/base64/subscription flow. */
export const browserPushPlatform: PushPlatform = {
  permission: () => Notification.permission,
  requestPermission: () => Notification.requestPermission(),
  existing: async () =>
    (
      await navigator.serviceWorker.getRegistration("/")
    )?.pushManager.getSubscription() ?? null,
  subscribe: async (key) => {
    const registration = await ensureNotificationWorker();
    const normalized = key.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(
      atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4)),
      (c) => c.charCodeAt(0),
    );
    return (
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      }))
    );
  },
};

// Fixed protocol revision bypasses legacy immutable HTTP cache without replacing
// the root registration (and its existing push subscription).
export const NOTIFICATION_WORKER_URL = "/loom-push-sw.js?protocol=local-v1";
export async function ensureNotificationWorker() {
  const registration = await navigator.serviceWorker.register(
    NOTIFICATION_WORKER_URL,
    { scope: "/", updateViaCache: "none" },
  );
  // register() may return the existing active worker without checking its bytes.
  // Explicitly update before relying on the current notification protocol.
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      registration.update(),
      new Promise<never>((_, reject) => {
        updateTimer = setTimeout(
          () => reject(Error("通知工作进程更新超时；未发送。")),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(updateTimer);
  }
  if (registration.installing || registration.waiting || !registration.active)
    await new Promise<void>((resolve, reject) => {
      const worker = registration.installing ?? registration.waiting;
      if (!worker) {
        reject(Error("通知工作进程未启动。"));
        return;
      }
      const done = () => {
        clearTimeout(timer);
        worker.removeEventListener("statechange", changed);
      };
      const changed = () => {
        if (worker.state === "activated") {
          done();
          resolve();
        } else if (worker.state === "redundant") {
          done();
          reject(Error("通知工作进程安装失败。"));
        }
      };
      const timer = setTimeout(() => {
        done();
        reject(Error("通知工作进程启动超时，请重新读取状态。"));
      }, 10000);
      worker.addEventListener("statechange", changed);
      changed();
    });
  return registration;
}
