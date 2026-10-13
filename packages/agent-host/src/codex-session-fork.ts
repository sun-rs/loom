import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  providerLaunchArguments,
  providerLaunchPolicy,
  providerMemoryConfig,
} from "./provider-launch-arguments.js";
import { stopOpenCodeServer as stopCopyProcess } from "./opencode-server-process.js";
import type { NativeSessionCopyInput } from "./native-session-copy.ts";

type Request = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;
/** Native data operation. Never starts a model turn or resumes the source. */
export async function forkCodexSession(
  request: Request,
  initialized: () => void,
  input: Pick<NativeSessionCopyInput, "sourceId" | "cwd">,
): Promise<string> {
  const hello = (await request("initialize", {
    clientInfo: { name: "loom-session-copy", version: "1" },
    capabilities: { experimentalApi: true },
  })) as { userAgent?: unknown };
  if (typeof hello?.userAgent !== "string")
    throw new Error("Native copy initialization failed");
  initialized();
  const result = (await request("thread/fork", {
    threadId: input.sourceId,
    cwd: input.cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
    config: providerMemoryConfig("codex"),
    persistExtendedHistory: true,
  })) as { thread?: { id?: unknown } };
  const id = result?.thread?.id;
  if (typeof id !== "string" || !id.trim() || id === input.sourceId)
    throw new Error("Native fork did not return an independent session");
  return id;
}

export async function copyCodexSession(
  input: NativeSessionCopyInput,
): Promise<string> {
  const policy = providerLaunchPolicy("codex", input.env, {
    codexExecutable: input.executable,
    cwd: input.cwd,
  });
  const child = spawn(
    input.executable,
    [
      ...providerLaunchArguments("codex", input.env),
      ...policy.args,
      "--listen",
      "stdio://",
    ],
    {
      cwd: input.cwd,
      env: { ...input.env, ...policy.environment },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let sequence = 0;
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
        fail(new Error("Native copy process exited"));
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
  const request: Request = (method, params) =>
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
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  try {
    return await forkCodexSession(
      request,
      () => {
        child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
      },
      input,
    );
  } finally {
    lines.close();
    await stopCopyProcess({ child, exited }, { termTimeoutMs: 2_000 });
  }
}
