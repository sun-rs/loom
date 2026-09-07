import type { IncomingMessage, ServerResponse } from "node:http";
import { WorkbenchServiceRestartRequestSchema } from "@rah-os/protocol";

export interface WorkbenchServiceControl {
  status(): { generation: string; state: "online" | "restarting" | "failed" };
  restart(generation: string): "accepted" | "stale" | "busy";
}

/** Deployment-only route; gateways supply authenticated session and origin checks. */
export async function handleWorkbenchServiceControl(
  request: IncomingMessage,
  response: ServerResponse,
  control: WorkbenchServiceControl | undefined,
  authenticated: boolean,
  sameOrigin: boolean,
): Promise<void> {
  const send = (status: number, body: object) => {
    response.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(body));
  };
  if (!authenticated) return send(401, { error: "unauthorized" });
  if (
    request.method === "GET" &&
    request.url?.split("?")[0] === "/_rah/service"
  ) {
    return send(
      200,
      control === undefined
        ? { available: false }
        : { available: true, ...control.status() },
    );
  }
  if (
    request.method !== "POST" ||
    request.url?.split("?")[0] !== "/_rah/service/restart"
  )
    return send(405, { error: "method_not_allowed" });
  if (!sameOrigin) return send(403, { error: "forbidden" });
  if (control === undefined) return send(503, { error: "unavailable" });
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (Buffer.byteLength(body) > 1024)
      return send(413, { error: "too_large" });
  }
  let parsed;
  try {
    parsed = WorkbenchServiceRestartRequestSchema.safeParse(JSON.parse(body));
  } catch {
    return send(400, { error: "invalid_request" });
  }
  if (!parsed.success) return send(400, { error: "invalid_request" });
  const result = control.restart(parsed.data.generation);
  send(result === "accepted" ? 202 : 409, { result, ...control.status() });
}
