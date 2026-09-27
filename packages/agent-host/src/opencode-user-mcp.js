// User MCP isolation on OpenCode (both drivers, cold and warm). Introduced
// with the §57 tool facade and kept when the facade was withdrawn (evo §59,
// owner 2026-09-27). Verified against the installed OpenCode 1.18.32 without
// a model call (a free probe of `opencode serve` under a temporary HOME):
//
// - A user's MCP server is switched off for this process only by writing
//   `mcp.<name> = {enabled:false}` into OPENCODE_CONFIG_CONTENT (OpenCode
//   deep-merges config sources; `GET /mcp` then reports
//   `{status:"disabled"}`). The user's files are never modified.
// - The names come from OpenCode's own resolution, `opencode debug config
//   --pure` ("show resolved configuration"), run with the server's
//   environment and cwd before the server starts, so no user server is ever
//   spawned. `--pure` matches the server's own `serve --pure` (no external
//   plugins).
// - After start the driver reads `GET /mcp`: every server must be
//   `disabled`, or the launch fails before any input (fail closed).
//
// Codex has the same per-name disable (provider-launch-arguments.js); Claude
// uses `--strict-mcp-config`.
import { spawn } from "node:child_process";

const RESOLVE_TIMEOUT_MS = 20_000;
const MAX_CONFIG_BYTES = 4 * 1024 * 1024;

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
 * The launch config content with every resolved server switched off, merged
 * into (never replacing) the content so far; unchanged when none resolved.
 */
export function openCodeConfigContentWithUserMcpDisabled(content, names) {
  if (names.length === 0) return content;
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
    mcp[name] = {
      ...(typeof mcp[name] === "object" && mcp[name] !== null ? mcp[name] : {}),
      enabled: false,
    };
  return JSON.stringify({ ...config, mcp });
}

/** `GET /mcp` after start: every server disabled, or the launch fails. */
export async function verifyOpenCodeUserMcpDisabled({ requestJson }) {
  const status = await requestJson("/mcp");
  if (typeof status !== "object" || status === null || Array.isArray(status))
    throw new Error("OpenCode GET /mcp returned no status map");
  const enabled = Object.entries(status)
    .filter(([, value]) => value?.status !== "disabled")
    .map(([name]) => name);
  if (enabled.length > 0)
    throw new Error(
      `OpenCode MCP servers are not disabled: ${enabled.join(", ")}`,
    );
}

/**
 * Both drivers: before the server starts, resolve the names; build the
 * config content; after it answers, verify.
 */
export async function prepareOpenCodeUserMcpIsolation({
  executable,
  env,
  cwd,
}) {
  const names = await resolveOpenCodeMcpNames({ executable, env, cwd });
  return {
    names,
    configContent: (content) =>
      openCodeConfigContentWithUserMcpDisabled(content, names),
    // Tagged so a driver's startup retry loop never retries a refusal.
    verify: async (requestJson) => {
      try {
        await verifyOpenCodeUserMcpDisabled({ requestJson });
      } catch (error) {
        throw Object.assign(
          error instanceof Error ? error : new Error(String(error)),
          { userMcp: true },
        );
      }
    },
  };
}
