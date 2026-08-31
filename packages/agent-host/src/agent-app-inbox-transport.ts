import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import {
  AgentAppInboxAckCommandSchema,
  AgentAppInboxCheckCommandSchema,
  AgentMemoryConfigPatchSchema,
  type AgentMemoryConfigSnapshot,
  type AgentMemoryConfigPatch,
  type AgentAppInboxAckResult,
} from "@rah-os/protocol";

import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";
import { createWorkerToolTransportEnvironment } from "./worker-tool-transport.ts";

/** Computer-private port, not a Room/Worker application service. Identity is
 * captured by the per-Run capability; callers cannot supply another owner.
 * Reuses the existing private credential, executable wrapper and lease cleanup.
 */
export async function createAgentAppInboxEnvironment(input: {
  credentialDirectory: string;
  ownerParticipantId: string;
  port: {
    checkInbox(ownerParticipantId: string): Promise<unknown>;
    getCleanerConfig?(owner: string): AgentMemoryConfigSnapshot;
    patchCleanerConfig?(
      owner: string,
      patch: AgentMemoryConfigPatch,
    ): AgentMemoryConfigSnapshot;
    recheckInbox(ownerParticipantId: string): Promise<unknown>;
    acknowledgeHint(
      ownerParticipantId: string,
      itemId: string,
      version: number,
    ): AgentAppInboxAckResult;
  };
}): Promise<ActivationEnvironmentLease> {
  const token = randomBytes(32).toString("hex");
  let active = true;
  let origin = "";
  const server = createServer({ maxHeaderSize: 8_192 }, (request, response) => {
    void (async () => {
      try {
        if (!active) throw new RequestFailure(401);
        if (
          request.headers.origin !== undefined ||
          request.headers.host !== new URL(origin).host
        )
          throw new RequestFailure(403);
        const credential = Buffer.from(request.headers.authorization ?? "");
        const expected = Buffer.from(`Bearer ${token}`);
        if (
          credential.length !== expected.length ||
          !timingSafeEqual(credential, expected)
        )
          throw new RequestFailure(401);
        if (request.method !== "POST") throw new RequestFailure(405);
        if (
          request.url !== "/v1/agent-inbox/check" &&
          request.url !== "/v1/agent-inbox/recheck" &&
          request.url !== "/v1/agent-config/get" &&
          request.url !== "/v1/agent-config/patch" &&
          request.url !== "/v1/agent-inbox/ack"
        )
          throw new RequestFailure(404);
        if (request.headers["content-type"] !== "application/json")
          throw new RequestFailure(415);
        const body = await readCommand(request);
        if (!active) throw new RequestFailure(401);
        let result: unknown;
        if (
          request.url === "/v1/agent-config/get" ||
          request.url === "/v1/agent-config/patch"
        ) {
          if (!input.port.getCleanerConfig || !input.port.patchCleanerConfig)
            throw new RequestFailure(503);
          if (request.url.endsWith("/get")) {
            if (!AgentAppInboxCheckCommandSchema.safeParse(body).success)
              throw new RequestFailure(400);
            result = input.port.getCleanerConfig(input.ownerParticipantId);
          } else {
            const command = AgentMemoryConfigPatchSchema.safeParse(body);
            if (!command.success) throw new RequestFailure(400);
            result = input.port.patchCleanerConfig(
              input.ownerParticipantId,
              command.data,
            );
          }
        } else if (
          request.url === "/v1/agent-inbox/check" ||
          request.url === "/v1/agent-inbox/recheck"
        ) {
          if (!AgentAppInboxCheckCommandSchema.safeParse(body).success)
            throw new RequestFailure(400);
          result =
            request.url === "/v1/agent-inbox/check"
              ? await input.port.checkInbox(input.ownerParticipantId)
              : await input.port.recheckInbox(input.ownerParticipantId);
        } else {
          const command = AgentAppInboxAckCommandSchema.safeParse(body);
          if (!command.success) throw new RequestFailure(400);
          result = input.port.acknowledgeHint(
            input.ownerParticipantId,
            command.data.itemId,
            command.data.version,
          );
        }
        if (!active || response.destroyed) return;
        response.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify(result));
      } catch (error) {
        // Never echo credentials, paths, filesystem errors or an arbitrary body.
        request.resume();
        if (response.destroyed) return;
        const conflict =
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "agent_memory_config_conflict";
        const status =
          error instanceof RequestFailure ? error.status : conflict ? 409 : 503;
        response.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(
          JSON.stringify({
            error: {
              message: conflict
                ? "Cleaner configuration revision conflict; reload before saving"
                : "Agent App Inbox request rejected or unavailable",
            },
          }),
        );
      }
    })();
  });
  server.maxConnections = 16;
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.setTimeout(15_000, (socket) => socket.destroy());
  server.unref();
  let closePromise: Promise<void> | undefined;
  const revoke = () => {
    active = false;
    closePromise ??= new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    return closePromise;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Agent Inbox listener is unavailable");
    origin = `http://127.0.0.1:${address.port}`;
    const lease = await createWorkerToolTransportEnvironment({
      credentialDirectory: input.credentialDirectory,
      revokeCredential: revoke,
      workerAccessToken: token,
      workerApiOrigin: origin,
    });
    return Object.freeze({
      env: Object.freeze({
        RAH_AGENT_INBOX_API_URL: origin,
        RAH_AGENT_INBOX_CLI: lease.env.RAH_WORKER_CLI!,
        RAH_AGENT_INBOX_SESSION_FILE: lease.env.RAH_WORKER_SESSION_FILE!,
      }),
      ...(lease.redactions === undefined
        ? {}
        : { redactions: lease.redactions }),
      ...(lease.release === undefined ? {} : { release: lease.release }),
    });
  } catch (error) {
    await revoke();
    throw error;
  }
}

class RequestFailure extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Invalid App Inbox request");
    this.status = status;
  }
}

function readCommand(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    const fail = (error: unknown) => {
      if (!finished) {
        finished = true;
        reject(error);
      }
    };
    request.on("error", () => fail(new RequestFailure(400)));
    request.on("aborted", () => fail(new RequestFailure(400)));
    request.on("data", (chunk: Buffer) => {
      if (finished) return;
      size += chunk.length;
      if (size > 4_096) {
        fail(new RequestFailure(413));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (finished) return;
      try {
        const value: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
        if (value === null || typeof value !== "object" || Array.isArray(value))
          throw new Error("object required");
        finished = true;
        resolve(value as Record<string, unknown>);
      } catch {
        fail(new RequestFailure(400));
      }
    });
  });
}
