import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  request as httpRequest,
  type Server,
  type ServerResponse,
  type IncomingMessage,
} from "node:http";
/** Isolated, PDF-only transport. No app routes, cookies, redirects or mutations. */
export class PdfPreviewGateway {
  readonly #key = randomBytes(32);
  #server: Server | undefined;
  #origin: string | undefined;
  readonly #options: {
    host: string;
    port?: number;
    appOrigin: string;
    daemonOrigin: string;
    accessToken: string;
    now?: () => number;
  };
  constructor(options: {
    host: string;
    port?: number;
    appOrigin: string;
    daemonOrigin: string;
    accessToken: string;
    now?: () => number;
  }) {
    this.#options = options;
  }
  get origin() {
    if (!this.#origin) throw Error("PDF origin not started");
    return this.#origin;
  }
  async start() {
    const server = createServer((req, res) => {
      void this.#handle(req, res).catch(() => {
        if (res.headersSent) res.destroy();
        else this.#fail(res, 502);
      });
    });
    this.#server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.#options.port ?? 0, this.#options.host, resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("PDF origin unavailable");
    this.#origin = `http://${this.#options.host}:${address.port}`;
  }
  async stop() {
    const server = this.#server;
    this.#server = undefined;
    this.#origin = undefined;
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((e) => (e ? reject(e) : resolve()));
      server.closeAllConnections();
    });
  }
  #now() {
    return (this.#options.now ?? Date.now)();
  }
  #signature(id: string, expires: string) {
    return createHmac("sha256", this.#key)
      .update(`${id}:${expires}`)
      .digest("hex");
  }
  async issue(id: string): Promise<string> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid attachment ID");
    // Recheck membership/type before minting; each subsequent range read also checks it.
    const response = await fetch(
      `${this.#options.daemonOrigin}/v3/client/files/pdf-preview/${id}`,
      {
        headers: {
          authorization: `Bearer ${this.#options.accessToken}`,
          range: "bytes=0-7",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    const valid =
      (response.status === 200 || response.status === 206) &&
      response.headers.get("content-type") === "application/pdf";
    await response.body?.cancel();
    if (!valid) throw Error("PDF preview unavailable");
    const expires = String(this.#now() + 30 * 60 * 1000);
    return `${this.origin}/pdf/${id}?expires=${expires}&signature=${this.#signature(id, expires)}`;
  }
  #fail(response: ServerResponse, status: number) {
    response.statusCode = status;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/plain");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end("PDF preview unavailable");
  }
  async #handle(request: IncomingMessage, response: ServerResponse) {
    if (request.headers.host !== new URL(this.origin).host) {
      this.#fail(response, 421);
      return;
    }
    const url = new URL(request.url ?? "/", this.origin),
      match = /^\/pdf\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (!match) {
      this.#fail(response, 404);
      return;
    }
    if (request.method !== "GET") {
      this.#fail(response, 405);
      return;
    }
    const id = match[1]!,
      expires = url.searchParams.get("expires") ?? "",
      signature = url.searchParams.get("signature") ?? "";
    const until = Number(expires),
      now = this.#now();
    if (
      !Number.isSafeInteger(until) ||
      until <= now ||
      until > now + 30 * 60 * 1000 ||
      !/[a-f0-9]{64}/.test(signature) ||
      signature.length !== 64 ||
      !timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(this.#signature(id, expires)),
      )
    ) {
      this.#fail(response, 403);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const upstream = httpRequest(
        `${this.#options.daemonOrigin}/v3/client/files/pdf-preview/${id}`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${this.#options.accessToken}`,
            ...(request.headers.range ? { range: request.headers.range } : {}),
          },
        },
        (incoming) => {
          if (
            ![200, 206, 416].includes(incoming.statusCode ?? 0) ||
            (incoming.statusCode !== 416 &&
              incoming.headers["content-type"] !== "application/pdf")
          ) {
            incoming.resume();
            this.#fail(response, incoming.statusCode === 403 ? 403 : 415);
            resolve();
            return;
          }
          response.statusCode = incoming.statusCode!;
          for (const name of [
            "content-type",
            "content-length",
            "content-range",
            "accept-ranges",
            "content-disposition",
          ]) {
            const value = incoming.headers[name];
            if (value !== undefined) response.setHeader(name, value);
          }
          response.setHeader("Cache-Control", "private, no-store");
          response.setHeader("X-Content-Type-Options", "nosniff");
          response.setHeader("Referrer-Policy", "no-referrer");
          response.setHeader(
            "Content-Security-Policy",
            `frame-ancestors ${this.#options.appOrigin}; object-src 'none'; base-uri 'none'; form-action 'none'`,
          );
          incoming.once("error", reject);
          incoming.once("end", resolve);
          incoming.pipe(response);
        },
      );
      response.once("close", () => upstream.destroy());
      upstream.once("error", reject);
      upstream.setTimeout(30000, () =>
        upstream.destroy(Error("PDF read timeout")),
      );
      upstream.end();
    });
  }
}
