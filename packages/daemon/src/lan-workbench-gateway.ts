import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  X509Certificate,
} from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  request as createHttpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer, type Server as HttpsServer } from "node:https";
import { isIP } from "node:net";
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  LanWorkbenchAccessStore,
  type LanWorkbenchDevice,
} from "./lan-workbench-access-store.ts";
import { readWebBuildId, WEB_BUILD_HEADER } from "./web-build-metadata.ts";

const SESSION_COOKIE = "rah_lan_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const API_PREFIXES = [
  "/v1/client",
  "/v2/client",
  "/v3/client",
  "/v1/local",
] as const;
const MAXIMUM_PAIRING_BODY_BYTES = 16 * 1_024;
const PAIRING_CODE_TTL_MS = 10 * 60_000;
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

type PairingAttemptWindow = {
  attempts: number;
  resetsAt: number;
};

export class LanWorkbenchGateway {
  readonly #accessStore: LanWorkbenchAccessStore;
  readonly #accessToken: string;
  readonly #bindHost: string;
  readonly #clock: () => number;
  readonly #daemonOrigin: URL;
  readonly #pairingAttempts = new Map<string, PairingAttemptWindow>();
  readonly #port: number;
  readonly #publicHostname: string;
  readonly #staticDirectory: string;
  readonly #tls: { certificate: Buffer; privateKey: Buffer };
  readonly #webBuildId: string | undefined;
  #origin: string | undefined;
  #server: HttpsServer | undefined;

  constructor(input: {
    accessStore: LanWorkbenchAccessStore;
    accessToken: string;
    bindHost: string;
    clock?: () => number;
    daemonOrigin: string;
    port: number;
    publicHostname: string;
    staticDirectory: string;
    tls: { certificate: Buffer; privateKey: Buffer };
  }) {
    if (input.accessToken.trim().length === 0) {
      throw new Error("LAN workbench Human access token is required");
    }
    if (
      !Number.isInteger(input.port) ||
      input.port < 0 ||
      input.port > 65_535
    ) {
      throw new Error("LAN workbench port must be between 0 and 65535");
    }
    if (!isAbsolute(input.staticDirectory)) {
      throw new Error("LAN workbench static directory must be absolute");
    }
    if (isIP(input.bindHost) === 0) {
      throw new Error("LAN workbench bind host must be an IP address");
    }
    const publicHostname = normalizePublicHostname(input.publicHostname);
    const daemonOrigin = new URL(input.daemonOrigin);
    if (
      daemonOrigin.protocol !== "http:" ||
      daemonOrigin.hostname !== "127.0.0.1" ||
      daemonOrigin.pathname !== "/"
    ) {
      throw new Error(
        "LAN workbench daemon origin must be an http://127.0.0.1 origin",
      );
    }
    if (
      input.tls.certificate.byteLength === 0 ||
      input.tls.privateKey.byteLength === 0
    ) {
      throw new Error(
        "LAN workbench TLS certificate and private key are required",
      );
    }
    validateLanTlsIdentity(
      input.tls,
      publicHostname,
      (input.clock ?? Date.now)(),
    );
    this.#accessStore = input.accessStore;
    this.#accessToken = input.accessToken;
    this.#bindHost = input.bindHost;
    this.#clock = input.clock ?? Date.now;
    this.#daemonOrigin = daemonOrigin;
    this.#port = input.port;
    this.#publicHostname = publicHostname;
    this.#staticDirectory = resolve(input.staticDirectory);
    this.#tls = input.tls;
    this.#webBuildId = readWebBuildId(this.#staticDirectory);
  }

  get origin(): string {
    if (this.#origin === undefined) {
      throw new Error("LAN workbench gateway has not started");
    }
    return this.#origin;
  }

  issuePairingCode() {
    return this.#accessStore.issuePairingCode({ ttlMs: PAIRING_CODE_TTL_MS });
  }

  async start(): Promise<void> {
    if (this.#server !== undefined) {
      throw new Error("LAN workbench gateway is already started");
    }
    const indexPath = resolve(this.#staticDirectory, "index.html");
    if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
      throw new Error(`LAN workbench Web build was not found at ${indexPath}`);
    }
    const server = createServer(
      {
        cert: this.#tls.certificate,
        key: this.#tls.privateKey,
        minVersion: "TLSv1.2",
      },
      (request, response) => {
        void this.#handle(request, response).catch((error: unknown) => {
          if (response.headersSent) {
            response.destroy(error instanceof Error ? error : undefined);
            return;
          }
          if (error instanceof GatewayRequestError) {
            sendText(response, error.statusCode, error.message);
            return;
          }
          sendText(response, 500, "LAN workbench gateway failure");
        });
      },
    );
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
      throw new Error("LAN workbench gateway did not bind a TCP port");
    }
    this.#origin = httpsOrigin(this.#publicHostname, address.port);
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    this.#origin = undefined;
    if (server === undefined || !server.listening) return;
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) =>
        error === undefined ? resolvePromise() : reject(error),
      );
      server.closeAllConnections();
    });
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    setSecurityHeaders(response);
    if (request.headers.host !== new URL(this.origin).host) {
      sendText(response, 421, "Misdirected request");
      return;
    }
    this.#setWebBuildHeader(response);
    const requestUrl = new URL(request.url ?? "/", this.origin);
    if (requestUrl.pathname.startsWith("/_rah/")) {
      await this.#handleGatewayRoute(request, response, requestUrl);
      return;
    }
    if (isApiPath(requestUrl.pathname)) {
      const device = this.#authenticatedDevice(request.headers.cookie);
      if (device === null) {
        sendText(response, 401, "LAN device pairing required");
        return;
      }
      if (!this.#hasExactMutationOrigin(request)) {
        sendText(response, 403, "Cross-origin mutation rejected");
        return;
      }
      await this.#proxy(request, response, requestUrl);
      return;
    }
    if (/^\/v\d+(?:\/|$)/u.test(requestUrl.pathname)) {
      sendText(response, 404, "Unknown API route");
      return;
    }
    if (
      request.method === "GET" &&
      request.headers.accept?.includes("text/html") === true &&
      this.#authenticatedDevice(request.headers.cookie) === null
    ) {
      redirect(response, "/_rah/pair");
      return;
    }
    await this.#serveStatic(request, response, requestUrl.pathname);
  }

  async #handleGatewayRoute(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<void> {
    if (requestUrl.pathname === "/_rah/health" && request.method === "GET") {
      sendJson(response, 200, {
        service: "rah-os-local-core",
        state: "online",
      });
      return;
    }
    if (requestUrl.pathname === "/_rah/pair") {
      if (request.method === "GET") {
        if (this.#authenticatedDevice(request.headers.cookie) !== null) {
          redirect(response, "/");
          return;
        }
        sendHtml(response, 200, pairingPage());
        return;
      }
      if (request.method !== "POST") {
        sendText(response, 405, "Method not allowed");
        return;
      }
      if (!this.#hasExactMutationOrigin(request)) {
        sendText(response, 403, "Cross-origin pairing rejected");
        return;
      }
      const remoteAddress = request.socket.remoteAddress ?? "unknown";
      if (!this.#consumePairingAttempt(remoteAddress)) {
        response.setHeader("retry-after", "300");
        sendText(response, 429, "Too many pairing attempts");
        return;
      }
      const pairing = await readPairingRequest(request);
      const result = this.#accessStore.exchangePairingCode(
        pairing.code,
        pairing.deviceName,
      );
      if (result === null) {
        sendText(response, 401, "Pairing code is invalid or expired");
        return;
      }
      this.#pairingAttempts.delete(remoteAddress);
      response.setHeader("set-cookie", sessionCookie(result.sessionToken));
      redirect(response, "/");
      return;
    }

    const device = this.#authenticatedDevice(request.headers.cookie);
    if (requestUrl.pathname === "/_rah/session" && request.method === "GET") {
      if (device === null) {
        sendJson(response, 401, { authenticated: false });
      } else {
        sendJson(response, 200, { authenticated: true, device });
      }
      return;
    }
    if (device === null) {
      sendText(response, 401, "LAN device pairing required");
      return;
    }
    if (requestUrl.pathname === "/_rah/devices" && request.method === "GET") {
      sendJson(response, 200, { devices: this.#accessStore.listDevices() });
      return;
    }
    if (
      requestUrl.pathname === "/_rah/pairing-codes" &&
      request.method === "POST"
    ) {
      if (!this.#hasExactMutationOrigin(request)) {
        sendText(response, 403, "Cross-origin mutation rejected");
        return;
      }
      await consumeEmptyJsonObject(request);
      sendJson(response, 201, this.issuePairingCode());
      return;
    }
    const revokeMatch = /^\/_rah\/devices\/([^/]+)\/revoke$/u.exec(
      requestUrl.pathname,
    );
    if (revokeMatch !== null && request.method === "POST") {
      if (!this.#hasExactMutationOrigin(request)) {
        sendText(response, 403, "Cross-origin mutation rejected");
        return;
      }
      await consumeEmptyJsonObject(request);
      const deviceId = decodeURIComponent(revokeMatch[1]!);
      if (!this.#accessStore.revokeDevice(deviceId)) {
        sendText(response, 404, "LAN device was not found");
        return;
      }
      if (deviceId === device.deviceId) {
        response.setHeader("set-cookie", expiredSessionCookie());
      }
      response.statusCode = 204;
      response.end();
      return;
    }
    sendText(response, 404, "Gateway route was not found");
  }

  #authenticatedDevice(cookieHeader: string | undefined) {
    const token = cookieValue(cookieHeader, SESSION_COOKIE);
    return token === undefined
      ? null
      : this.#accessStore.authenticateSession(token);
  }

  #hasExactMutationOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    return (
      SAFE_METHODS.has(request.method ?? "GET") ||
      origin === this.origin ||
      ((origin === undefined || origin === "null") &&
        request.headers["sec-fetch-site"] === "same-origin")
    );
  }

  #consumePairingAttempt(remoteAddress: string): boolean {
    const now = this.#clock();
    const existing = this.#pairingAttempts.get(remoteAddress);
    const window =
      existing === undefined || existing.resetsAt <= now
        ? { attempts: 0, resetsAt: now + 5 * 60_000 }
        : existing;
    window.attempts += 1;
    this.#pairingAttempts.set(remoteAddress, window);
    if (this.#pairingAttempts.size > 1_024) {
      for (const [address, candidate] of this.#pairingAttempts) {
        if (candidate.resetsAt <= now) this.#pairingAttempts.delete(address);
      }
    }
    return window.attempts <= 5;
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
      request.pipe(upstream);
    });
  }

  async #serveStatic(
    request: IncomingMessage,
    response: ServerResponse,
    encodedPathname: string,
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
    const candidate = resolve(
      this.#staticDirectory,
      pathname.replace(/^\/+/, ""),
    );
    const relativePath = relative(this.#staticDirectory, candidate);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
      sendText(response, 404, "Not found");
      return;
    }
    const staticPath =
      relativePath.length > 0 &&
      existsSync(candidate) &&
      statSync(candidate).isFile()
        ? candidate
        : resolve(this.#staticDirectory, "index.html");
    const isIndex = staticPath.endsWith(`${sep}index.html`);
    response.statusCode = 200;
    response.setHeader("content-type", contentType(staticPath));
    response.setHeader(
      "cache-control",
      isIndex
        ? "no-store"
        : revalidatedShellFile(staticPath)
          ? "no-cache"
          : "public, max-age=31536000, immutable",
    );
    this.#setWebBuildHeader(response);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createReadStream(staticPath);
      stream.once("error", reject);
      stream.once("end", resolvePromise);
      stream.pipe(response);
    });
  }

  #setWebBuildHeader(response: ServerResponse): void {
    if (this.#webBuildId !== undefined) {
      response.setHeader(WEB_BUILD_HEADER, this.#webBuildId);
    }
  }
}

function revalidatedShellFile(path: string): boolean {
  return ["manifest.webmanifest", "sw.js"].includes(basename(path));
}

function normalizePublicHostname(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /[\s/?#@]/u.test(trimmed)) {
    throw new Error("LAN public hostname is invalid");
  }
  const parsed = new URL(`https://${trimmed}`);
  if (parsed.port !== "" || parsed.pathname !== "/") {
    throw new Error("LAN public hostname must not include a port or path");
  }
  return parsed.hostname;
}

export function validateLanTlsIdentity(
  tls: { certificate: Buffer; privateKey: Buffer },
  publicHostname: string,
  now: number,
): X509Certificate {
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(tls.certificate);
  } catch {
    throw new Error("LAN TLS certificate is not valid X.509 PEM");
  }
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if (!Number.isFinite(now) || now < validFrom || now > validTo) {
    throw new Error("LAN TLS certificate is not currently valid");
  }
  const covered =
    isIP(publicHostname) === 0
      ? certificate.checkHost(publicHostname)
      : certificate.checkIP(publicHostname);
  if (covered === undefined) {
    throw new Error("LAN TLS certificate does not cover the public hostname");
  }
  let privatePublicKey: ReturnType<typeof createPublicKey>;
  try {
    privatePublicKey = createPublicKey(createPrivateKey(tls.privateKey));
  } catch {
    throw new Error("LAN TLS private key is invalid");
  }
  const certificateKey = certificate.publicKey.export({
    format: "der",
    type: "spki",
  });
  const suppliedKey = privatePublicKey.export({ format: "der", type: "spki" });
  if (!certificateKey.equals(suppliedKey)) {
    throw new Error("LAN TLS private key does not match the certificate");
  }
  return certificate;
}

function httpsOrigin(hostname: string, port: number): string {
  const url = new URL("https://localhost");
  url.hostname = hostname;
  url.port = port === 443 ? "" : String(port);
  return url.origin;
}

function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function cookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim().split("=", 2))
    .find(([candidate]) => candidate === name)?.[1];
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`;
}

function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

async function readPairingRequest(
  request: IncomingMessage,
): Promise<{ code: string; deviceName: string }> {
  const serialized = await readBoundedBody(request);
  const contentType = request.headers["content-type"] ?? "";
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(serialized);
    return {
      code: form.get("code") ?? "",
      deviceName: form.get("deviceName") ?? "",
    };
  }
  if (contentType.startsWith("application/json")) {
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new GatewayRequestError(400, "Pairing body must be valid JSON");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new GatewayRequestError(400, "Pairing body must be an object");
    }
    const record = value as Record<string, unknown>;
    return {
      code: typeof record.code === "string" ? record.code : "",
      deviceName:
        typeof record.deviceName === "string" ? record.deviceName : "",
    };
  }
  throw new GatewayRequestError(415, "Unsupported pairing content type");
}

async function consumeEmptyJsonObject(request: IncomingMessage): Promise<void> {
  const serialized = await readBoundedBody(request);
  if (serialized.trim().length === 0) return;
  try {
    const value = JSON.parse(serialized) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length !== 0
    ) {
      throw new Error("not empty");
    }
  } catch {
    throw new GatewayRequestError(400, "Request body must be an empty object");
  }
}

async function readBoundedBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAXIMUM_PAIRING_BODY_BYTES) {
      throw new GatewayRequestError(413, "Request body is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
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
    case ".webmanifest":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("content-security-policy", CONTENT_SECURITY_POLICY);
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader(
    "strict-transport-security",
    "max-age=31536000; includeSubDomains",
  );
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  body: string,
): void {
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(body);
}

function sendHtml(
  response: ServerResponse,
  statusCode: number,
  body: string,
): void {
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(body);
}

function redirect(response: ServerResponse, location: string): void {
  response.statusCode = 303;
  response.setHeader("cache-control", "no-store");
  response.setHeader("location", location);
  response.end();
}

function pairingPage(): string {
  const nonce = randomUUID();
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>RAH OS · 设备配对</title>
    <style>
      :root{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#111;background:#fffaf0}
      *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#ffd440}
      main{width:min(92vw,34rem);background:#fffaf0;border:3px solid #111;box-shadow:6px 6px 0 #111;padding:2rem}
      h1{margin:0 0 .5rem;font-size:2rem}p{color:#666;line-height:1.5}
      label{display:grid;gap:.5rem;margin:1.25rem 0;font-weight:700}
      input,button{min-height:3rem;border:3px solid #111;background:#fff;padding:.65rem .8rem;font:inherit}
      input:focus-visible,button:focus-visible{outline:3px solid #2fc5e5;outline-offset:2px}
      button{width:100%;background:#f875a1;font-weight:800;box-shadow:3px 3px 0 #111;cursor:pointer}
    </style>
  </head>
  <body data-page-id="${nonce}">
    <main>
      <h1>设备配对</h1>
      <p>在 RAH Core 所在 Mac 的终端中取得一次性配对码。此设备不会获得或保存 Core 的 Human access token。</p>
      <form method="post" action="/_rah/pair">
        <label>设备名称<input name="deviceName" maxlength="80" required autocomplete="name"></label>
        <label>配对码<input name="code" maxlength="14" required autocomplete="one-time-code" autocapitalize="characters"></label>
        <button type="submit">连接 RAH Core</button>
      </form>
    </main>
  </body>
</html>`;
}

class GatewayRequestError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
