import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { prepareOpenCodeUserMcpIsolation } from "./opencode-user-mcp.js";
import {
  providerLaunchArguments,
  providerLaunchPolicy,
} from "./provider-launch-arguments.js";
import { stopOpenCodeServer } from "./opencode-server-process.js";
import { record } from "./opencode-server-client.js";

type Request = (path: string, init?: RequestInit) => Promise<unknown>;
/** Native data operation only: never starts a model turn, never edits the source. */
export async function forkOpenCodeSession(
  request: Request,
  sourceId: string,
): Promise<string> {
  const status = record(record(await request("/session/status"))[sourceId]);
  if (status.type !== undefined && status.type !== "idle")
    throw new Error("Native source session must be idle before Fork");
  const result = record(
    await request(`/session/${encodeURIComponent(sourceId)}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  if (typeof result.id !== "string" || !result.id || result.id === sourceId)
    throw new Error("Native fork did not return an independent session");
  return result.id;
}

/** Short-lived authenticated loopback server, using the source runtime's environment and cwd. */
export async function copyOpenCodeSession(input: {
  executable: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  sourceId: string;
}): Promise<string> {
  const env: NodeJS.ProcessEnv = {
    ...input.env,
    ...providerLaunchPolicy("opencode", input.env).environment,
    OPENCODE_SERVER_USERNAME: "loom-fork",
    OPENCODE_SERVER_PASSWORD: randomBytes(32).toString("hex"),
  };
  const isolation = await prepareOpenCodeUserMcpIsolation({ ...input, env });
  const child = spawn(
    input.executable,
    [
      ...providerLaunchArguments("opencode", env),
      "--hostname",
      "127.0.0.1",
      "--port",
      "0",
    ],
    {
      cwd: input.cwd,
      env: {
        ...env,
        OPENCODE_CONFIG_CONTENT: isolation.configContent(
          env.OPENCODE_CONFIG_CONTENT ?? "{}",
        ),
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let failed: Error | undefined,
    output = "",
    baseUrl: string | undefined;
  child.on("error", (error) => {
    failed = error;
  });
  child.stdout.on("data", (data: Buffer) => {
    output = (output + data.toString()).slice(-8192);
    baseUrl ??= /http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];
  });
  // Consume diagnostics, but never return credentials or provider config in HTTP errors.
  child.stderr.resume();
  const exited = new Promise<{ code: number | null; signal: string | null }>(
    (resolve) =>
      child.once("close", (code, signal) => resolve({ code, signal })),
  );
  const request: Request = async (path, init = {}) => {
    if (!baseUrl) throw new Error("Native fork server has no address");
    const headers = new Headers(init.headers);
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`${env.OPENCODE_SERVER_USERNAME}:${env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`,
    );
    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`Native fork request failed (${response.status})`);
    return await response.json();
  };
  try {
    const deadline = Date.now() + 30_000;
    while (!baseUrl) {
      if (failed || child.exitCode !== null || child.signalCode !== null)
        throw new Error("Native fork server failed to start");
      if (Date.now() >= deadline)
        throw new Error("Native fork server startup timed out");
      await delay(50);
    }
    await isolation.verify(request);
    return await forkOpenCodeSession(request, input.sourceId);
  } finally {
    await stopOpenCodeServer({ child, exited }, { termTimeoutMs: 2_000 });
  }
}
