import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  providerLaunchArguments,
  providerLaunchPolicy,
} from "./provider-launch-arguments.js";
import { stopOpenCodeServer as stopCopyProcess } from "./opencode-server-process.js";
import type { NativeSessionCopyInput } from "./native-session-copy.ts";

export async function copyKimiSession(
  input: NativeSessionCopyInput,
): Promise<string> {
  const policy = providerLaunchPolicy("kimi", input.env);
  const child = spawn(
    input.executable,
    [...providerLaunchArguments("kimi", input.env), ...policy.args],
    {
      cwd: input.cwd,
      env: { ...input.env, ...policy.environment },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let sequence = 0;
  let draining = false;
  let failure: Error | undefined;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const fail = (error: Error) => {
    failure = error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  child.on("error", () =>
    fail(new Error("Native copy process failed to start")),
  );
  child.stdin.on("error", () =>
    fail(new Error("Native copy transport failed")),
  );
  child.stderr.resume(); // Provider diagnostics may contain private configuration.
  const exited = new Promise<{ code: number | null; signal: string | null }>(
    (resolve) =>
      child.once("close", (code, signal) => {
        if (!draining) fail(new Error("Native copy process exited"));
        resolve({ code, signal });
      }),
  );
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object") return;
    if (typeof frame.method === "string") {
      // No approvals/tools are part of a copy. Fail closed, never execute a server request.
      if (frame.id !== undefined)
        fail(new Error("Unexpected native copy server request"));
      return;
    }
    const waiter = pending.get(frame.id);
    if (!waiter) return;
    if (frame.error) waiter.reject(new Error("Native copy request failed"));
    else waiter.resolve(frame.result);
  });
  const request = (
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Native copy request timed out"));
      }, 30_000);
      pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        },
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  try {
    const hello = (await request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "loom-session-copy", version: "1" },
    })) as {
      protocolVersion?: unknown;
      agentCapabilities?: { sessionCapabilities?: { fork?: unknown } };
    };
    if (
      hello?.protocolVersion !== 1 ||
      !hello.agentCapabilities?.sessionCapabilities?.fork
    )
      throw new Error("Native Kimi copy is not supported by this CLI");
    const result = (await request("session/fork", {
      sessionId: input.sourceId,
      cwd: input.cwd,
      mcpServers: [],
    })) as { sessionId?: unknown };
    const id = result?.sessionId;
    if (typeof id !== "string" || !id.trim() || id === input.sourceId)
      throw new Error("Native fork did not return an independent session");
    // EOF drains native writes. A signal-induced exit cannot prove persistence.
    draining = true;
    child.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const exit = await Promise.race([
        exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Native copy EOF timed out")),
            5_000,
          );
        }),
      ]);
      if (failure) throw failure;
      if (exit.code !== 0 || exit.signal !== null)
        throw new Error("Native copy did not exit cleanly");
    } finally {
      clearTimeout(timer);
    }
    return id;
  } finally {
    lines.close();
    await stopCopyProcess({ child, exited }, { termTimeoutMs: 2_000 });
  }
}
