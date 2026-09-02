const CACHE_NAME = "rah-os-shell-v1";
const SHELL_RESOURCES = ["/", "/manifest.webmanifest", "/rah-app-icon.svg"];

function targetUrl(target) {
  if (!target || typeof target !== "object" || typeof target.kind !== "string")
    return "/";
  const params = new URLSearchParams({ target: target.kind });
  const required = (name) => {
    const value = target[name];
    if (typeof value !== "string" || value.length === 0) throw new Error();
    return value;
  };
  try {
    if (target.kind === "agent") {
      params.set("surface", "agents");
      params.set("agent", required("agentDefinitionId"));
      params.set(
        "agentTab",
        typeof target.tab === "string" ? target.tab : "profile",
      );
    } else if (target.kind === "computer") {
      params.set("surface", "computers");
      params.set("computer", required("hostId"));
    } else {
      params.set("room", required("roomId"));
      if (target.kind === "message") {
        params.set("message", required("messageId"));
        if (typeof target.threadId === "string")
          params.set("threadId", target.threadId);
        if (typeof target.rootMessageId === "string")
          params.set("thread", `${target.roomId}:${target.rootMessageId}`);
      } else if (target.kind === "thread") {
        params.set("threadId", required("threadId"));
        if (typeof target.rootMessageId === "string")
          params.set("thread", `${target.roomId}:${target.rootMessageId}`);
      } else if (target.kind === "task") {
        params.set("roomTab", "tasks");
        params.set("task", required("taskId"));
        if (typeof target.threadId === "string")
          params.set("threadId", target.threadId);
        if (typeof target.rootMessageId === "string")
          params.set("thread", `${target.roomId}:${target.rootMessageId}`);
      } else if (target.kind === "input_request") {
        params.set("inputRequest", required("inputRequestId"));
      } else if (target.kind === "artifact") {
        params.set("roomTab", "files");
        params.set("artifact", required("artifactId"));
        if (typeof target.messageId === "string")
          params.set("message", target.messageId);
      } else if (target.kind !== "room") throw new Error();
    }
    return `/?${params}`;
  } catch {
    return "/";
  }
}

function sameTarget(left, right) {
  const a = new URL(left, self.location.origin);
  const b = new URL(right, self.location.origin);
  return (
    a.origin === b.origin && a.pathname === b.pathname && a.search === b.search
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_RESOURCES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET") return;

  const { pathname } = url;
  if (/^\/v\d+\//u.test(pathname) || pathname.startsWith("/_rah/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            void caches
              .open(CACHE_NAME)
              .then((cache) => cache.put("/", response.clone()));
          }
          return response;
        })
        .catch(async () => (await caches.match("/")) ?? Response.error()),
    );
    return;
  }

  if (
    ["font", "image", "manifest", "script", "style"].includes(
      request.destination,
    )
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok && response.type === "basic") {
              void caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, response.clone()));
            }
            return response;
          }),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload;
      try {
        payload = event.data?.json();
      } catch {
        payload = { title: "RAH OS", body: event.data?.text() ?? "" };
      }
      const url = targetUrl(payload?.target);
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (
        !payload?.alwaysShow &&
        windows.some(
          (client) =>
            (client.focused || client.visibilityState === "visible") &&
            sameTarget(client.url, url),
        )
      )
        return;
      await self.registration.showNotification(payload?.title ?? "RAH OS", {
        body: payload?.body ?? "",
        icon: "/rah-app-icon.svg",
        badge: "/rah-app-icon.svg",
        tag: payload?.tag ?? "rah-os",
        data: { url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url =
        typeof event.notification.data?.url === "string"
          ? event.notification.data.url
          : "/";
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find((client) => sameTarget(client.url, url));
      if (existing) {
        existing.postMessage({ type: "RAH_PUSH_NOTIFICATION_NAVIGATE", url });
        await existing.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
