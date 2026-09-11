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
let pendingDecision: Promise<void> | undefined;
let resolvePendingDecision: (() => void) | undefined;
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
  probeBeforeMount: () => Promise<void>;
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

  const probe = () => probeCurrentBuild(currentBuildId, "initial_probe");
  window.addEventListener("focus", () => void probe());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void probe();
  });
  window.setInterval(() => void probe(), 15_000);

  return { probeBeforeMount: probe };
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
  nonce = crypto.randomUUID(),
): string {
  return `/?rah_build_probe=${encodeURIComponent(currentBuildId)}&rah_probe_nonce=${encodeURIComponent(nonce)}`;
}

async function probeCurrentBuild(
  currentBuildId: string,
  trigger: "initial_probe",
): Promise<void> {
  try {
    await globalThis.fetch(webBuildProbeUrl(currentBuildId), {
      cache: "no-store",
      credentials: "same-origin",
      method: "HEAD",
    });
  } catch {
    // Connectivity recovery owns an unavailable gateway. A missing response
    // cannot prove that this browser build is stale.
  }
  if (activePrompt?.trigger === trigger) await waitForRecoveryDecision();
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
      // A cached resource can carry an older build header than this document.
      // Only a fresh shell probe may establish the current server identity.
      let verifiedBuildId: string | undefined;
      try {
        const probe = await originalFetch!(webBuildProbeUrl(currentBuildId), {
          method: "HEAD",
          cache: "no-store",
          credentials: "same-origin",
          signal: AbortSignal.timeout(3000),
        });
        if (probe.ok)
          verifiedBuildId = probe.headers.get(WEB_BUILD_HEADER)?.trim();
      } catch {
        /* An unavailable probe cannot establish a stale document. */
      }
      if (
        !verifiedBuildId ||
        verifiedBuildId === currentBuildId ||
        verifiedBuildId === ignoredServerBuildId
      )
        return response;
      showRefreshPrompt({
        reason: "build_mismatch",
        serverBuildId: verifiedBuildId,
        trigger:
          typeof input === "string" && input.includes("rah_build_probe=")
            ? "initial_probe"
            : "fetch_response",
      });
      await waitForRecoveryDecision();
    }
    return response;
  };
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
  pendingDecision ??= new Promise<void>((resolve) => {
    resolvePendingDecision = resolve;
  });
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
      <h1 id="${REFRESH_LAYER_ID}-title">刷新 RAH OS 以继续</h1>
      <p>此标签页运行的是较旧的应用版本。请刷新以加载当前版本；此标签页中未发送的文本或未保存的更改可能会丢失。</p>
      <div class="rah-web-build-refresh-actions">
        <a role="button" data-refresh>立即刷新</a>
        <button type="button" data-continue>仍然继续</button>
      </div>
    </section>`;
  document.body.append(layer);
  const root = document.getElementById("root");
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
  resolvePendingDecision?.();
  resolvePendingDecision = undefined;
  pendingDecision = undefined;
}

async function waitForRecoveryDecision(): Promise<void> {
  if (pendingDecision !== undefined) await pendingDecision;
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
