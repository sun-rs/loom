import type { RahClient } from "@rah-os/client-sdk";
import type { ClientPushConfigurationResponse } from "@rah-os/protocol";

export type BrowserPushStatus = {
  browserSubscribed: boolean;
  configuration?: ClientPushConfigurationResponse;
  permission: NotificationPermission | "unsupported";
  supported: boolean;
};

export type BrowserPushReconciliation =
  "none" | "request_on_gesture" | "subscribe" | "unsubscribe";

type BrowserPushServiceWorkerContainer = Pick<
  ServiceWorkerContainer,
  "getRegistration" | "register"
>;

const SERVICE_WORKER_PATH = "/sw.js";

const BROWSER_PUSH_PREFERENCE_KEY = "rah:web-push-desired:v1";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function readBrowserPushPreference(storage: PreferenceStorage) {
  try {
    return storage.getItem(BROWSER_PUSH_PREFERENCE_KEY) !== "disabled";
  } catch {
    return true;
  }
}

export function writeBrowserPushPreference(
  storage: PreferenceStorage,
  desired: boolean,
) {
  try {
    storage.setItem(
      BROWSER_PUSH_PREFERENCE_KEY,
      desired ? "enabled" : "disabled",
    );
  } catch {
    // A browser that blocks local preference storage still keeps the product
    // default enabled. The explicit unsubscribe below remains authoritative
    // for the current subscription.
  }
}

export function browserPushReconciliation(input: {
  browserSubscribed: boolean;
  desired: boolean;
  permission: NotificationPermission | "unsupported";
  supported: boolean;
}): BrowserPushReconciliation {
  if (!input.desired) return input.browserSubscribed ? "unsubscribe" : "none";
  if (!input.supported || input.permission === "unsupported") return "none";
  if (input.permission === "default") return "request_on_gesture";
  if (input.permission === "denied") return "none";
  return input.browserSubscribed ? "none" : "subscribe";
}

export function applicationServerKeyBytes(
  value: string,
): Uint8Array<ArrayBuffer> {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const binary = atob(padded.replace(/-/gu, "+").replace(/_/gu, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function browserPushSupported() {
  return (
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Raft's status path reads the existing root registration and never creates a
 * new one. Re-registering on every focus/visibility refresh is observably
 * racy in Firefox and can surface a false NetworkError after a successful
 * test push.
 */
export async function existingBrowserPushRegistration(
  serviceWorker: BrowserPushServiceWorkerContainer = navigator.serviceWorker,
): Promise<ServiceWorkerRegistration | null> {
  const registration = (await serviceWorker.getRegistration("/")) ?? null;
  if (registration) void registration.update().catch(() => undefined);
  return registration;
}

/** Register only on an explicit enable path, matching Raft's b4/hce/Lit flow. */
export async function ensureBrowserPushRegistration(
  serviceWorker: BrowserPushServiceWorkerContainer = navigator.serviceWorker,
): Promise<ServiceWorkerRegistration | null> {
  const existing = await existingBrowserPushRegistration(serviceWorker);
  if (existing) return existing;
  try {
    const registration = await serviceWorker.register(SERVICE_WORKER_PATH);
    void registration.update().catch(() => undefined);
    return registration;
  } catch (failure) {
    console.error("[Push] Failed to register service worker:", failure);
    return null;
  }
}

export async function readBrowserPushStatus(
  client: RahClient,
): Promise<BrowserPushStatus> {
  if (!browserPushSupported())
    return {
      browserSubscribed: false,
      permission: "unsupported",
      supported: false,
    };
  const [configuration, registration] = await Promise.all([
    client.request("push.configuration", {}),
    existingBrowserPushRegistration(),
  ]);
  return {
    browserSubscribed: Boolean(
      registration && (await registration.pushManager.getSubscription()),
    ),
    configuration,
    permission: Notification.permission,
    supported: configuration.supported,
  };
}

export async function enableBrowserPush(
  client: RahClient,
  requestPermission: boolean,
): Promise<BrowserPushStatus> {
  if (!browserPushSupported()) return await readBrowserPushStatus(client);
  let permission = Notification.permission;
  if (permission === "default" && requestPermission)
    permission = await Notification.requestPermission();
  if (permission !== "granted") return await readBrowserPushStatus(client);
  const configuration = await client.request("push.configuration", {});
  const registration = await ensureBrowserPushRegistration();
  if (!registration) throw new Error("无法注册通知 Service Worker");
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKeyBytes(
        configuration.applicationServerKey,
      ),
    }));
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.auth || !serialized.keys.p256dh)
    throw new Error("浏览器返回了不完整的 Push subscription");
  await client.request("push.subscribe", {
    subscription: {
      endpoint: serialized.endpoint,
      keys: { auth: serialized.keys.auth, p256dh: serialized.keys.p256dh },
    },
  });
  return await readBrowserPushStatus(client);
}

export async function disableBrowserPush(client: RahClient) {
  if (!browserPushSupported()) return await readBrowserPushStatus(client);
  const registration = await existingBrowserPushRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await client.request("push.unsubscribe", { endpoint });
  }
  return await readBrowserPushStatus(client);
}
