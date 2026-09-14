import { browserOpaqueId } from "./browser-opaque-id.ts";
const WEB_BUILD_HEADER = "x-rah-web-build-id";
const REFRESH_LAYER_ID = "rah-web-build-refresh-layer";
const RECOVERY_QUERY = "rah_recover";
const CACHE_PREFIXES = ["rah-os-shell-", "rah-os-assets-"] as const;
const DEVELOPMENT_BUILD_ID = "development";

type RecoveryReason = "build_mismatch" | "dynamic_import_failure";
type RecoveryTrigger =
  | "fetch_response"
  | "initial_probe"
  | "later_action"
  | "unhandled_rejection"
  | "vite_preload_error";

let activePrompt:
  | { reason: RecoveryReason; serverBuildId?: string; trigger: RecoveryTrigger }
  | undefined;
let ignoredServerBuildId: string | undefined;
let pendingVerification: Promise<void> | undefined;
let originalFetch: typeof globalThis.fetch | undefined;

export function isStaleWebBuildError(error: unknown): boolean {
  const name = error instanceof Error ? error.name.toLowerCase() : "";
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    name === "chunkloaderror" ||
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("failed to load module script") ||
    message.includes("loading chunk") ||
    message.includes("css_chunk_load_failed")
  );
}

export function recoveryUrl(currentUrl: string, nonce = Date.now()): string {
  const target = new URL(currentUrl);
  target.searchParams.set(RECOVERY_QUERY, String(nonce));
  return target.toString();
}

export function webBuildCacheNames(names: readonly string[]): string[] {
  return names.filter((name) =>
    CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );
}

export function currentWebBuildId(): string {
  const content = document
    .querySelector<HTMLMetaElement>('meta[name="rah-web-build-id"]')
    ?.content.trim();
  return content || DEVELOPMENT_BUILD_ID;
}

export function installWebBuildRecovery(currentBuildId: string): {
  probe: () => Promise<void>;
} {
  removeRecoveryNonce();
  installFetchBuildFence(currentBuildId);

  window.addEventListener("vite:preloadError", (event) => {
    const error = (event as Event & { payload?: unknown }).payload ?? event;
    if (requestWebBuildRefresh(error, "vite_preload_error")) {
      event.preventDefault();
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (requestWebBuildRefresh(event.reason, "unhandled_rejection")) {
      event.preventDefault();
    }
  });

  const probe = () => probeCurrentBuild(currentBuildId);
  window.addEventListener("focus", () => void probe());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void probe();
  });
  window.setInterval(() => void probe(), 15_000);

  return { probe };
}

export function requestWebBuildRefresh(
  error: unknown,
  trigger: Exclude<RecoveryTrigger, "fetch_response" | "initial_probe">,
): boolean {
  if (!isStaleWebBuildError(error)) return false;
  showRefreshPrompt({ reason: "dynamic_import_failure", trigger });
  return true;
}

export function webBuildProbeUrl(
  currentBuildId: string,
  nonce = browserOpaqueId(),
): string {
  return `/?rah_build_probe=${encodeURIComponent(currentBuildId)}&rah_probe_nonce=${encodeURIComponent(nonce)}`;
}

async function probeCurrentBuild(currentBuildId: string): Promise<void> {
  try {
    await globalThis.fetch(webBuildProbeUrl(currentBuildId), {
      cache: "no-store",
      credentials: "same-origin",
      method: "HEAD",
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Connectivity recovery owns an unavailable gateway. A missing response
    // cannot prove that this browser build is stale.
  }
}

function installFetchBuildFence(currentBuildId: string): void {
  if (originalFetch !== undefined) return;
  originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch!(input, init);
    const serverBuildId = response.headers.get(WEB_BUILD_HEADER)?.trim();
    if (
      serverBuildId &&
      currentBuildId &&
      serverBuildId !== currentBuildId &&
      serverBuildId !== ignoredServerBuildId
    ) {
      // Version discovery is advisory: never withhold an accepted API response
      // or let the refresh dialog consume the client's request deadline.
      pendingVerification ??= verifyCurrentBuild(
        currentBuildId,
        typeof input === "string" && input.includes("rah_build_probe=")
          ? "initial_probe"
          : "fetch_response",
      ).finally(() => {
        pendingVerification = undefined;
      });
    }
    return response;
  };
}

async function verifyCurrentBuild(
  currentBuildId: string,
  trigger: "initial_probe" | "fetch_response",
): Promise<void> {
  // Cached responses may carry a historical header. Only a fresh shell probe
  // can establish the current server identity; concurrent mismatches share it.
  try {
    const probe = await originalFetch!(webBuildProbeUrl(currentBuildId), {
      method: "HEAD",
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(3000),
    });
    const verifiedBuildId = probe.ok
      ? probe.headers.get(WEB_BUILD_HEADER)?.trim()
      : undefined;
    if (
      verifiedBuildId &&
      verifiedBuildId !== currentBuildId &&
      verifiedBuildId !== ignoredServerBuildId
    ) {
      showRefreshPrompt({
        reason: "build_mismatch",
        serverBuildId: verifiedBuildId,
        trigger,
      });
    }
  } catch {
    // Connectivity recovery owns unavailable probes, not build recovery.
  }
}

function showRefreshPrompt(prompt: typeof activePrompt): void {
  if (prompt === undefined) return;
  if (
    activePrompt?.reason === prompt.reason &&
    activePrompt.serverBuildId === prompt.serverBuildId
  ) {
    return;
  }
  activePrompt = prompt;
  const confirmedNewBuild = prompt.reason === "build_mismatch";
  const root = document.getElementById("root");
  const canContinue = confirmedNewBuild || Boolean(root?.childElementCount);
  document.getElementById(REFRESH_LAYER_ID)?.remove();

  const layer = document.createElement("div");
  layer.id = REFRESH_LAYER_ID;
  layer.dataset.reason = prompt.reason;
  layer.dataset.trigger = prompt.trigger;
  layer.dataset.clientBuild = currentWebBuildId();
  if (prompt.serverBuildId) layer.dataset.serverBuild = prompt.serverBuildId;
  layer.className = "rah-web-build-refresh-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-labelledby", `${REFRESH_LAYER_ID}-title`);
  layer.innerHTML = `
    <section class="rah-web-build-refresh-card">
      <h1 id="${REFRESH_LAYER_ID}-title">${confirmedNewBuild ? "刷新 RAH OS 以继续" : "页面资源加载失败"}</h1>
      <p>${confirmedNewBuild ? "此标签页运行的是较旧的应用版本。请刷新以加载当前版本；此标签页中未发送的文本或未保存的更改可能会丢失。" : "网络连接或页面资源暂时不可用，尚不能确认版本发生变化。连接恢复后请重新加载；未发送的文本或未保存的更改可能会丢失。"}</p>
      <div class="rah-web-build-refresh-actions">
        <a role="button" data-refresh>${confirmedNewBuild ? "立即刷新" : "重新加载"}</a>
        ${canContinue ? `<button type="button" data-continue>${confirmedNewBuild ? "仍然继续" : "关闭提示"}</button>` : ""}
      </div>
    </section>`;
  document.body.append(layer);
  if (root instanceof HTMLElement) root.inert = true;

  const refresh = layer.querySelector<HTMLAnchorElement>("[data-refresh]");
  const continueAnyway =
    layer.querySelector<HTMLButtonElement>("[data-continue]");
  if (refresh) {
    refresh.href = recoveryUrl(window.location.href);
    refresh.addEventListener("click", () => {
      void prepareRefreshCaches();
    });
    refresh.addEventListener("keydown", (event) => {
      if (event.key === " ") {
        event.preventDefault();
        refresh.click();
      }
    });
  }
  continueAnyway?.addEventListener("click", continueWithOldBuild);
  layer.tabIndex = -1;
  layer.focus();
}

function continueWithOldBuild(): void {
  if (activePrompt?.serverBuildId) {
    ignoredServerBuildId = activePrompt.serverBuildId;
  }
  activePrompt = undefined;
  document.getElementById(REFRESH_LAYER_ID)?.remove();
  const root = document.getElementById("root");
  if (root instanceof HTMLElement) root.inert = false;
}

async function prepareRefreshCaches(): Promise<void> {
  const work: Promise<unknown>[] = [];
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        if (new URL(registration.scope).origin === window.location.origin) {
          work.push(registration.update().catch(() => undefined));
        }
      }
      work.push(
        navigator.serviceWorker
          .register("/sw.js", { updateViaCache: "none" })
          .catch(() => undefined),
      );
    }
    if ("caches" in window) {
      const cacheNames = webBuildCacheNames(await window.caches.keys());
      for (const cacheName of cacheNames) {
        work.push(window.caches.delete(cacheName).catch(() => false));
      }
    }
    await Promise.all(work);
  } catch {
    // Cleanup is best-effort; the native link owns explicit navigation.
  }
}

function removeRecoveryNonce(): void {
  const current = new URL(window.location.href);
  if (!current.searchParams.has(RECOVERY_QUERY)) return;
  current.searchParams.delete(RECOVERY_QUERY);
  window.history.replaceState(window.history.state, "", current.toString());
}
