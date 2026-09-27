// evo §57: the Loom Worker tool facade on OpenCode (both drivers, cold and
// warm). Verified against the installed OpenCode 1.18.32 without a model call
// (review 2026-09-27 and a free probe of `opencode serve` with the real Loom
// entry):
//
// - `OPENCODE_CONFIG_CONTENT.mcp.loom = {type:"local", command:[...]}` makes
//   the server start `"$RAH_WORKER_CLI" __worker-mcp` as its child (so inside
//   the driver's process group, inheriting the server environment and the
//   LOOM_RUNTIME_ID/LOOM_RUN_ID sweep labels); the model sees the tools as
//   `loom_message_post` / `loom_message_check`. The config names only a
//   command path: no token is written anywhere.
// - A user's MCP server is switched off for this process only by writing
//   `mcp.<name> = {enabled:false}` into the same variable (OpenCode deep-merges
//   config sources; `GET /mcp` then reports `{status:"disabled"}`). The user's
//   files are never modified.
// - The names come from OpenCode's own resolution, `opencode debug config
//   --pure` ("show resolved configuration"), run with the server's
//   environment and cwd before the server starts, so no user server is ever
//   spawned. `--pure` matches the server's own `serve --pure` (no external
//   plugins).
// - After start the driver reads `GET /mcp`: `loom` must be `connected` and
//   every other server `disabled`, or the launch fails (fail closed: the
//   standing prompt and the wake already name the tools).
//
// Owner decision 2026-09-27 (deviation from Raft 1.0.32's CLI posting).
import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

/** Set by the daemon's standing-prompt lease (`worker-tool-names.ts`). */
export const RAH_WORKER_TOOLS_ENV = "RAH_WORKER_TOOLS";
export const OPENCODE_WORKER_TOOLS_MODE = "opencode";
export const LOOM_MCP_SERVER = "loom";
/** `WORKER_MCP_ARGUMENT` of the Worker CLI. */
export const WORKER_MCP_ARGUMENT = "__worker-mcp";

const RESOLVE_TIMEOUT_MS = 20_000;
const VERIFY_TIMEOUT_MS = 15_000;
const MAX_CONFIG_BYTES = 4 * 1024 * 1024;

/**
 * Whether this launch carries the facade, and its MCP command. The lease
 * asked for it: without an absolute Worker CLI the launch fails.
 */
export function openCodeWorkerToolCommand(env = process.env) {
  if (env[RAH_WORKER_TOOLS_ENV] !== OPENCODE_WORKER_TOOLS_MODE)
    return undefined;
  const cli = env.RAH_WORKER_CLI;
  if (typeof cli !== "string" || !isAbsolute(cli))
    throw new Error(
      "the Loom Worker tools need an absolute RAH_WORKER_CLI; the launch is refused",
    );
  return [cli, WORKER_MCP_ARGUMENT];
}

/** Every MCP server name OpenCode itself resolves for this launch. */
export async function resolveOpenCodeMcpNames({
  executable,
  env,
  cwd,
  timeoutMs = RESOLVE_TIMEOUT_MS,
}) {
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(executable, ["debug", "config", "--pure"], {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let bytes = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("opencode debug config timed out"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_CONFIG_BYTES) {
        child.kill("SIGKILL");
        return;
      }
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err = `${err}${chunk}`.slice(-2048);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && bytes <= MAX_CONFIG_BYTES) resolve(out);
      else
        reject(
          new Error(
            `opencode debug config failed (code=${String(code)})${err.trim() === "" ? "" : `: ${err.trim()}`}`,
          ),
        );
    });
  });
  let config;
  try {
    config = JSON.parse(stdout);
  } catch {
    throw new Error("opencode debug config did not print a JSON config");
  }
  const mcp = config?.mcp;
  if (mcp === undefined || mcp === null) return [];
  if (typeof mcp !== "object" || Array.isArray(mcp))
    throw new Error("opencode debug config has an invalid mcp section");
  return Object.keys(mcp);
}

/**
 * The launch config content: `mcp.loom` added and every other resolved
 * server switched off, merged into (never replacing) the content so far.
 */
export function openCodeConfigContentWithWorkerTools(
  content,
  { command, names },
) {
  let config;
  try {
    config = JSON.parse(content);
  } catch {
    throw new Error("OPENCODE_CONFIG_CONTENT is not JSON");
  }
  if (typeof config !== "object" || config === null || Array.isArray(config))
    throw new Error("OPENCODE_CONFIG_CONTENT is not an object");
  const existing =
    typeof config.mcp === "object" &&
    config.mcp !== null &&
    !Array.isArray(config.mcp)
      ? config.mcp
      : {};
  const mcp = { ...existing };
  for (const name of names)
    if (name !== LOOM_MCP_SERVER)
      mcp[name] = {
        ...(typeof mcp[name] === "object" && mcp[name] !== null
          ? mcp[name]
          : {}),
        enabled: false,
      };
  mcp[LOOM_MCP_SERVER] = {
    type: "local",
    command: [...command],
    enabled: true,
  };
  return JSON.stringify({ ...config, mcp });
}

/**
 * `GET /mcp` after start: `loom` connected, every other server disabled.
 * Waits while `loom` is still connecting; anything else fails the launch.
 */
export async function verifyOpenCodeWorkerTools({
  requestJson,
  timeoutMs = VERIFY_TIMEOUT_MS,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await requestJson("/mcp");
    if (typeof status !== "object" || status === null || Array.isArray(status))
      throw new Error("OpenCode GET /mcp returned no status map");
    const enabled = Object.entries(status)
      .filter(([name]) => name !== LOOM_MCP_SERVER)
      .filter(([, value]) => value?.status !== "disabled")
      .map(([name]) => name);
    if (enabled.length > 0)
      throw new Error(
        `OpenCode MCP servers outside Loom are not disabled: ${enabled.join(", ")}`,
      );
    const loom = status[LOOM_MCP_SERVER]?.status;
    if (loom === "connected") return;
    if (loom !== undefined && loom !== "pending" && loom !== "connecting")
      throw new Error(
        `the Loom Worker MCP entry is ${String(loom)}${typeof status[LOOM_MCP_SERVER]?.error === "string" ? `: ${status[LOOM_MCP_SERVER].error}` : ""}`,
      );
    if (Date.now() >= deadline)
      throw new Error("the Loom Worker MCP entry did not connect in time");
    await delay(100);
  }
}

/**
 * Both drivers: before the server starts, resolve the names and build the
 * config content; after it answers, verify. `undefined` when the lease did
 * not ask for the tools (the launch is unchanged).
 */
export async function prepareOpenCodeWorkerTools({ executable, env, cwd }) {
  const command = openCodeWorkerToolCommand(env);
  if (command === undefined) return undefined;
  const names = await resolveOpenCodeMcpNames({ executable, env, cwd });
  return {
    command,
    names,
    configContent: (content) =>
      openCodeConfigContentWithWorkerTools(content, { command, names }),
    // Tagged so a driver's startup retry loop never retries a refusal.
    verify: async (requestJson) => {
      try {
        await verifyOpenCodeWorkerTools({ requestJson });
      } catch (error) {
        throw Object.assign(
          error instanceof Error ? error : new Error(String(error)),
          { workerTools: true },
        );
      }
    },
  };
}

/** A tool part that is the Loom `message_post` call (final interrupt). */
export function isLoomFinalPostPart(part) {
  const state =
    typeof part?.state === "object" && part.state !== null ? part.state : {};
  const input =
    typeof state.input === "object" && state.input !== null ? state.input : {};
  return (
    typeof part?.tool === "string" &&
    part.tool === `${LOOM_MCP_SERVER}_message_post` &&
    input.final === true
  );
}
