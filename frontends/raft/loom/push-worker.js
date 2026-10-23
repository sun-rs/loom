/* Structural port of Raft public/sw.js push/click handlers. Native asset-cache
 * prefix is included verbatim at build time; Loom typed target replaces data.url.
 * This worker owns no business acknowledgement or transcript storage. */
function validTarget(target) {
  if (
    !target ||
    typeof target !== "object" ||
    JSON.stringify(target).length > 4096
  )
    return false;
  const required = {
    room: ["roomId"],
    message: ["roomId", "messageId"],
    thread: ["roomId", "threadId"],
    task: ["roomId", "taskId"],
    input_request: ["roomId", "inputRequestId"],
    computer: ["hostId"],
  };
  return (
    required[target.kind]?.every(
      (k) =>
        typeof target[k] === "string" &&
        target[k].length > 0 &&
        target[k].length <= 300,
    ) ?? false
  );
}
function isSameNotificationTarget(clientUrl, target) {
  try {
    const url = new URL(clientUrl);
    if (url.origin !== self.location.origin) return false;
    if (target.kind === "computer")
      return (
        url.searchParams.get("view") === "computers" &&
        url.searchParams.get("computer") === target.hostId
      );
    if (target.kind === "task")
      return (
        url.searchParams.get("taskChannel") === target.roomId &&
        url.searchParams.get("task") === target.taskId
      );
    if (target.kind === "input_request") return false;
    if (
      url.searchParams.has("view") ||
      url.searchParams.get("room") !== target.roomId
    )
      return false;
    if (target.threadId && !target.rootMessageId) return false;
    return url.searchParams.get("thread") === (target.rootMessageId ?? null);
  } catch {
    return false;
  }
}
// One worker serializes both transports. Only bounded notification IDs are stored;
// never messages, business cursors or read acknowledgements.
let notificationWork = Promise.resolve();
function displayNotification(data, progress = () => {}) {
  const work = notificationWork
    .catch(() => {})
    .then(async () => {
      if (
        data?.version !== 1 ||
        !validTarget(data.target) ||
        typeof data.title !== "string" ||
        typeof data.body !== "string" ||
        typeof data.notificationId !== "string" ||
        data.notificationId.length > 300
      )
        throw Error("Invalid notification");
      progress("clients");
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (
        !data.alwaysShow &&
        clients.some(
          (client) =>
            (client.focused || client.visibilityState === "visible") &&
            isSameNotificationTarget(client.url, data.target),
        )
      )
        return;
      progress("receipts");
      const cache = await caches.open("loom-notification-receipts-v1");
      const key =
        self.location.origin +
        "/__notification_receipt/" +
        encodeURIComponent(data.notificationId);
      if (await cache.match(key)) return;
      progress("display");
      await self.registration.showNotification(data.title.slice(0, 200), {
        body: data.body.slice(0, 1000),
        icon: "/android-chrome-192x192.png",
        badge: "/favicon-32x32.png",
        tag:
          typeof data.tag === "string" ? data.tag.slice(0, 300) : "loom-push",
        data: { target: data.target },
      });
      progress("save");
      await cache.put(key, new Response("1"));
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - 500)))
        await cache.delete(old);
    });
  notificationWork = work;
  return work;
}
self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    return;
  }
  event.waitUntil(displayNotification(data).catch(() => {}));
});
self.addEventListener("message", (event) => {
  if (event.data?.type !== "LOOM_LOCAL_NOTIFY") return;
  const reply = (value) => event.ports?.[0]?.postMessage(value);
  try {
    if (new URL(event.source?.url).origin !== self.location.origin) {
      reply({ ok: false, error: "source" });
      return;
    }
  } catch {
    reply({ ok: false, error: "source" });
    return;
  }
  reply({ stage: "received" });
  event.waitUntil(
    displayNotification(event.data.payload, (stage) => reply({ stage })).then(
      () => event.ports?.[0]?.postMessage({ ok: true }),
      () => event.ports?.[0]?.postMessage({ ok: false }),
    ),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.target;
  if (!validTarget(target)) return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const matching = clients.find((client) =>
          isSameNotificationTarget(client.url, target),
        );
        if (matching) {
          matching.postMessage({ type: "LOOM_PUSH_NAVIGATE", target });
          await matching.focus();
          return;
        }
        await self.clients.openWindow(
          "/?" + new URLSearchParams({ push: JSON.stringify(target) }),
        );
      }),
  );
});
