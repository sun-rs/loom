import { sendStaticFile } from "./static-file-response.ts";
import { recoveryAssetPath, recoveryShell } from "./web-recovery-assets.ts";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import {
  handleWorkbenchServiceControl,
  type WorkbenchServiceControl,
} from "./workbench-service-control.ts";
import { existsSync, statSync } from "node:fs";
import {
  createServer,
  request as createHttpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { workbenchHealthPayload } from "./daemon-health.ts";
import { readWebBuildId, WEB_BUILD_HEADER } from "./web-build-metadata.ts";

const SESSION_COOKIE = "rah_workbench_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const API_PREFIXES = [
  "/v1/client",
  "/v2/client",
  "/v3/client",
  "/v1/local",
] as const;
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self' blob:",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");
/**
 * Throwaway evo console (docs/evo/status.zh-CN.md §44): served from its own
 * build directory under this prefix, outside the apps/web service worker
 * scope. Deleted in phase 4 together with apps/console.
 */
const CONSOLE_PREFIX = "/_rah/console";
const CONSOLE_UNAVAILABLE =
  "Loom console is not built; run npm run build:console";

export class LocalWorkbenchGateway {
  readonly #serviceControl: WorkbenchServiceControl | undefined;
  readonly #accessToken: string;
  readonly #daemonOrigin: URL;
  readonly #port: number;
  readonly #bindHost: string;
  readonly #sessionToken: string | undefined;
  readonly #browserAccess: "session" | "trusted-network";
  readonly #staticDirectory: string;
  readonly #consoleDirectory: string | undefined;
  readonly #webBuildId: string | undefined;
  #origin: string | undefined;
  #server: Server | undefined;
  #additional: LocalWorkbenchGateway[] = [];
  readonly #createAdditional: (port: number) => LocalWorkbenchGateway[];

  constructor(input: {
    serviceControl?: WorkbenchServiceControl;
    accessToken: string;
    /** Explicit trusted Tailnet/private LAN binding; public and wildcard interfaces are rejected. */
    bindHost?: string;
    additionalBindHosts?: string[];
    daemonOrigin: string;
    port: number;
    browserAccess?: "session" | "trusted-network";
    sessionToken?: string;
    staticDirectory: string;
    /** Absolute apps/console build directory; absent means the console is unavailable. */
    consoleDirectory?: string;
  }) {
    if (input.accessToken.trim().length === 0) {
      throw new Error("local workbench Human access token is required");
    }
    if (
      !Number.isInteger(input.port) ||
      input.port < 0 ||
      input.port > 65_535
    ) {
      throw new Error("local workbench port must be between 0 and 65535");
    }
    if (!isAbsolute(input.staticDirectory)) {
      throw new Error("local workbench static directory must be absolute");
    }
    if (
      input.consoleDirectory !== undefined &&
      !isAbsolute(input.consoleDirectory)
    ) {
      throw new Error("local workbench console directory must be absolute");
    }
    const browserAccess = input.browserAccess ?? "session";
    if (
      browserAccess !== "trusted-network" &&
      !/^[A-Za-z0-9_-]{43}$/u.test(input.sessionToken ?? "")
    ) {
      throw new Error("local workbench session token is malformed");
    }
    const daemonOrigin = new URL(input.daemonOrigin);
    if (
      daemonOrigin.protocol !== "http:" ||
      daemonOrigin.hostname !== "127.0.0.1" ||
      daemonOrigin.pathname !== "/"
    ) {
      throw new Error(
        "local workbench daemon origin must be an http://127.0.0.1 origin",
      );
    }
    const bindHost = input.bindHost ?? "127.0.0.1";
    const octets = bindHost.split(".").map(Number);
    if (
      bindHost !== "127.0.0.1" &&
      !(
        browserAccess === "trusted-network" &&
        isIP(bindHost) === 4 &&
        /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(bindHost)
      ) &&
      !(
        isIP(bindHost) === 4 &&
        octets[0] === 100 &&
        octets[1]! >= 64 &&
        octets[1]! <= 127
      )
    ) {
      throw new Error(
        "Unpaired HTTP requires loopback or an explicit trusted private/Tailnet IPv4 address",
      );
    }
    const additional = [
      ...new Set(
        input.additionalBindHosts ??
          (bindHost === "127.0.0.1" ? [] : ["127.0.0.1"]),
      ),
    ].filter((host) => host !== bindHost);
    this.#createAdditional = (port) =>
      additional.map(
        (host) =>
          new LocalWorkbenchGateway({
            ...input,
            bindHost: host,
            port,
            additionalBindHosts: [],
          }),
      );
    this.#bindHost = bindHost;
    this.#serviceControl = input.serviceControl;
    this.#accessToken = input.accessToken;
    this.#daemonOrigin = daemonOrigin;
    this.#port = input.port;
    this.#sessionToken = input.sessionToken;
    this.#browserAccess = browserAccess;
    this.#staticDirectory = resolve(input.staticDirectory);
    this.#consoleDirectory =
      input.consoleDirectory === undefined
        ? undefined
        : resolve(input.consoleDirectory);
    this.#webBuildId = readWebBuildId(this.#staticDirectory);
  }

  get origin(): string {
    if (this.#origin === undefined) {
      throw new Error("local workbench gateway has not started");
    }
    return this.#origin;
  }

  async start(): Promise<void> {
    if (this.#server !== undefined) {
      throw new Error("local workbench gateway is already started");
    }
    const indexPath = resolve(this.#staticDirectory, "index.html");
    if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
      throw new Error(
        `local workbench Web build was not found at ${indexPath}`,
      );
    }
    const server = createServer((request, response) => {
      void this.#handle(request, response).catch((error: unknown) => {
        if (response.headersSent) {
          response.destroy(error instanceof Error ? error : undefined);
          return;
        }
        sendText(response, 500, "Local workbench gateway failure");
      });
    });
    this.#server = server;
    try {
      await new Promise<void>((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(this.#port, this.#bindHost, resolvePromise);
      });
    } catch (error) {
      this.#server = undefined;
      throw error;
    }
    const address = server.address();
    if (address === null || typeof address === "string") {
      await this.stop();
      throw new Error("local workbench gateway did not bind a TCP port");
    }
    this.#origin = `http://${this.#bindHost}:${String(address.port)}`;
    try {
      this.#additional = this.#createAdditional(address.port);
      for (const gateway of this.#additional) await gateway.start();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const additional = this.#additional;
    this.#additional = [];
    await Promise.all(additional.map((gateway) => gateway.stop()));
    const server = this.#server;
    this.#server = undefined;
    this.#origin = undefined;
    if (server === undefined || !server.listening) return;
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) =>
        error === undefined ? resolvePromise() : reject(error),
      );
      // Match the LAN gateway: a stalled browser request cannot prevent Core drain.
      server.closeAllConnections();
    });
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const expectedHost = new URL(this.origin).host;
    if (request.headers.host !== expectedHost) {
      sendText(response, 421, "Misdirected request");
      return;
    }
    this.#setWebBuildHeader(response);
    const requestUrl = new URL(request.url ?? "/", this.origin);
    if (
      requestUrl.pathname === "/_rah/service" ||
      requestUrl.pathname === "/_rah/service/restart"
    ) {
      await handleWorkbenchServiceControl(
        request,
        response,
        this.#serviceControl,
        () => this.#hasSession(request.headers.cookie),
        request.headers.origin === this.origin,
      );
      return;
    }
    if (requestUrl.pathname === "/_rah/health" && request.method === "GET") {
      // The Core and this gateway are one build, so the identity here is the
      // daemon's own. It is the acceptance surface compared against Settings →
      // 关于 after a restart, in development as well as in a formal release.
      sendJson(response, 200, workbenchHealthPayload());
      return;
    }
    if (requestUrl.pathname === "/_rah/session" && request.method === "GET") {
      // Capability discovery is not a LAN session or an authentication grant.
      sendJson(response, 200, { available: false });
      return;
    }
    if (isApiPath(requestUrl.pathname)) {
      if (!this.#hasSession(request.headers.cookie)) {
        if (this.#mayRenewSession(request)) this.#setSessionCookie(response);
        sendJson(response, 401, {
          error: {
            code: "session_expired",
            message: "本地工作台会话已更新，正在重新连接",
          },
        });
        return;
      }
      const method = request.method ?? "GET";
      if (!SAFE_METHODS.has(method) && request.headers.origin !== this.origin) {
        sendJson(response, 403, {
          error: {
            code: "forbidden",
            message: "Cross-origin mutation rejected",
          },
        });
        return;
      }
      await this.#proxy(request, response, requestUrl);
      return;
    }
    if (/^\/v\d+(?:\/|$)/u.test(requestUrl.pathname)) {
      sendJson(response, 404, {
        error: { code: "not_found", message: "Unknown API route" },
      });
      return;
    }
    const recoveredAsset = recoveryAssetPath(requestUrl.pathname);
    if (recoveredAsset) {
      await this.#serveStatic(
        request,
        response,
        recoveredAsset,
        undefined,
        true,
      );
      return;
    }
    if (requestUrl.pathname === CONSOLE_PREFIX) {
      response.statusCode = 301;
      response.setHeader("cache-control", "no-store");
      response.setHeader("location", `${CONSOLE_PREFIX}/`);
      response.end();
      return;
    }
    if (requestUrl.pathname.startsWith(`${CONSOLE_PREFIX}/`)) {
      const consoleDirectory = this.#consoleDirectory;
      const consoleIndex =
        consoleDirectory === undefined
          ? undefined
          : resolve(consoleDirectory, "index.html");
      if (
        consoleDirectory === undefined ||
        consoleIndex === undefined ||
        !existsSync(consoleIndex) ||
        !statSync(consoleIndex).isFile()
      ) {
        sendText(response, 404, CONSOLE_UNAVAILABLE);
        return;
      }
      const consolePath = requestUrl.pathname.slice(CONSOLE_PREFIX.length);
      if (hasEncodedTraversal(consolePath)) {
        sendText(response, 404, "Not found");
        return;
      }
      await this.#serveStatic(
        request,
        response,
        consolePath,
        undefined,
        false,
        consoleDirectory,
      );
      return;
    }
    if (requestUrl.pathname.startsWith("/_rah/")) {
      sendText(response, 404, "LAN gateway route unavailable");
      return;
    }
    await this.#serveStatic(
      request,
      response,
      requestUrl.pathname,
      requestUrl.searchParams.get("rah_recover"),
    );
  }

  #hasSession(cookieHeader: string | undefined): boolean {
    if (this.#browserAccess === "trusted-network") return true;
    if (this.#sessionToken === undefined) return false;
    const supplied = cookieHeader
      ?.split(";")
      .map((part) => part.trim().split("=", 2))
      .find(([name]) => name === SESSION_COOKIE)?.[1];
    if (supplied === undefined) return false;
    const expectedBytes = Buffer.from(this.#sessionToken);
    const suppliedBytes = Buffer.from(supplied);
    return (
      expectedBytes.length === suppliedBytes.length &&
      timingSafeEqual(expectedBytes, suppliedBytes)
    );
  }

  #mayRenewSession(request: IncomingMessage): boolean {
    return (
      request.headers.origin === this.origin ||
      request.headers["sec-fetch-site"] === "same-origin"
    );
  }

  #setSessionCookie(response: ServerResponse): void {
    if (this.#browserAccess === "trusted-network") return;
    response.setHeader(
      "set-cookie",
      `${SESSION_COOKIE}=${this.#sessionToken}; HttpOnly; SameSite=Strict; Path=/`,
    );
  }

  async #proxy(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const headers = proxyRequestHeaders(request.headers, this.#accessToken);
      const upstream = createHttpRequest(
        new URL(
          `${requestUrl.pathname}${requestUrl.search}`,
          this.#daemonOrigin,
        ),
        { headers, method: request.method },
        (upstreamResponse) => {
          response.statusCode = upstreamResponse.statusCode ?? 502;
          copyResponseHeaders(upstreamResponse.headers, response);
          this.#setWebBuildHeader(response);
          upstreamResponse.once("error", reject);
          upstreamResponse.once("end", resolvePromise);
          upstreamResponse.pipe(response);
        },
      );
      upstream.once("error", reject);
      request.once("error", reject);
      // Release the daemon-side request when its browser goes away, including stop().
      response.once("close", () => upstream.destroy());
      request.pipe(upstream);
    });
  }

  async #serveStatic(
    request: IncomingMessage,
    response: ServerResponse,
    encodedPathname: string,
    recoveryNonce?: string | null,
    recoveringAsset = false,
    root = this.#staticDirectory,
  ): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method not allowed");
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(encodedPathname);
    } catch {
      sendText(response, 400, "Invalid URL encoding");
      return;
    }
    if (pathname.includes("\0")) {
      sendText(response, 400, "Invalid path");
      return;
    }
    const candidate = resolve(root, pathname.replace(/^\/+/, ""));
    const relativePath = relative(root, candidate);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      sendText(response, 404, "Not found");
      return;
    }
    if (
      pathname.startsWith("/assets/") &&
      (!existsSync(candidate) || !statSync(candidate).isFile())
    ) {
      sendText(response, 404, "Asset not found");
      return;
    }
    const staticPath =
      relativePath.length > 0 &&
      existsSync(candidate) &&
      statSync(candidate).isFile()
        ? candidate
        : resolve(root, "index.html");
    const isIndex = staticPath.endsWith(`${sep}index.html`);
    response.statusCode = 200;
    response.setHeader("content-type", contentType(staticPath));
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("content-security-policy", CONTENT_SECURITY_POLICY);
    this.#setWebBuildHeader(response);
    if (isIndex) {
      response.setHeader("cache-control", "no-store");
      this.#setSessionCookie(response);
    } else {
      response.setHeader(
        "cache-control",
        recoveringAsset
          ? "no-store"
          : revalidatedShellFile(staticPath)
            ? "no-cache"
            : "public, max-age=31536000, immutable",
      );
    }
    if (isIndex && recoveryNonce) {
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      response.end(
        recoveryShell(await readFile(staticPath, "utf8"), recoveryNonce),
      );
      return;
    }
    await sendStaticFile(request, response, staticPath);
  }

  #setWebBuildHeader(response: ServerResponse): void {
    if (this.#webBuildId !== undefined) {
      response.setHeader(WEB_BUILD_HEADER, this.#webBuildId);
    }
  }
}

/** Console paths never carry a dot segment or a backslash, encoded or not. */
function hasEncodedTraversal(encodedPathname: string): boolean {
  let pathname: string;
  try {
    pathname = decodeURIComponent(encodedPathname);
  } catch {
    return true;
  }
  return (
    pathname.includes("\\") ||
    pathname.split("/").some((segment) => segment === "..")
  );
}

function revalidatedShellFile(path: string): boolean {
  return ["manifest.webmanifest", "sw.js"].includes(basename(path));
}

function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function proxyRequestHeaders(
  source: IncomingHttpHeaders,
  accessToken: string,
): IncomingHttpHeaders {
  return {
    ...(source.accept === undefined ? {} : { accept: source.accept }),
    ...(source["content-length"] === undefined
      ? {}
      : { "content-length": source["content-length"] }),
    ...(source["content-type"] === undefined
      ? {}
      : { "content-type": source["content-type"] }),
    ...(source.range === undefined ? {} : { range: source.range }),
    authorization: `Bearer ${accessToken}`,
  };
}

function copyResponseHeaders(
  source: IncomingHttpHeaders,
  response: ServerResponse,
): void {
  for (const name of [
    "accept-ranges",
    "cache-control",
    "content-length",
    "content-range",
    "content-type",
  ]) {
    const value = source[name];
    if (value !== undefined) response.setHeader(name, value);
  }
  response.setHeader("x-content-type-options", "nosniff");
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".mjs":
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  body: string,
): void {
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(body);
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
): void {
  const body = Buffer.from(JSON.stringify(value));
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", String(body.byteLength));
  response.end(body);
}
