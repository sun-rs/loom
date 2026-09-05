const DEFAULT_DAEMON_PORT = 43111;

export const RAH_AUTH_REQUIRED_EVENT = "rah:auth-required";

function computeDefaultBaseUrl(): string {
  if (typeof window === "undefined") {
    return `http://127.0.0.1:${DEFAULT_DAEMON_PORT}`;
  }
  if (window.location.port && window.location.port !== "43112") {
    return window.location.origin;
  }
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const hostname = window.location.hostname || "127.0.0.1";
  return `${protocol}//${hostname}:${DEFAULT_DAEMON_PORT}`;
}

export function getBaseUrl(): string {
  if (typeof window === "undefined") return computeDefaultBaseUrl();
  let configured: string | null = null;
  try {
    configured = window.localStorage.getItem("rah.baseUrl");
  } catch {
    configured = null;
  }
  const trimmed = configured?.trim();
  if (!trimmed) {
    return computeDefaultBaseUrl();
  }

  try {
    const configuredUrl = new URL(trimmed);
    const currentHostname = window.location.hostname || "127.0.0.1";
    if (configuredUrl.hostname !== currentHostname) {
      return computeDefaultBaseUrl();
    }
  } catch {
    return computeDefaultBaseUrl();
  }

  return trimmed;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function buildRequestHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers ?? {});
  if (init?.body !== undefined && init.body !== null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (typeof window !== "undefined" && !headers.has("x-rah-client")) {
    headers.set("x-rah-client", "web");
  }
  return headers;
}
