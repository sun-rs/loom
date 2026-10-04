import { randomUUID } from "node:crypto";
import { isSea } from "node:sea";
import { constants } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";
import {
  createClaudeColdWorkerMcpBridge,
  createKimiColdWorkerMcpBridge,
} from "./worker-mcp-bridge.ts";

/** One fresh cold process owns one immutable Run authority, including resume. */
async function coldWorkerMcpLease(
  provider: "claude" | "kimi",
  runAttemptId: string,
  lease: ActivationEnvironmentLease,
): Promise<ActivationEnvironmentLease> {
  if (isSea()) return lease; // The source-only MCP entry is unavailable in SEA.
  const tokenPath = lease.env.RAH_WORKER_SESSION_FILE;
  const origin = lease.env.RAH_WORKER_API_URL;
  if (tokenPath === undefined && origin === undefined) return lease;
  let directory: string | undefined;
  let bridge:
    Awaited<ReturnType<typeof createClaudeColdWorkerMcpBridge>> | undefined;
  let active = true;
  let released: Promise<void> | undefined;
  const release = () =>
    (released ??= (async () => {
      active = false;
      try {
        await bridge?.close();
      } finally {
        try {
          if (directory) await rm(directory, { recursive: true, force: true });
        } finally {
          await lease.release?.();
        }
      }
    })());
  try {
    if (
      !tokenPath ||
      !origin ||
      !isAbsolute(tokenPath) ||
      tokenPath.includes("\0")
    )
      throw Error("Incomplete cold Worker authority");
    if (
      lease.args?.some(
        (arg) =>
          arg === "--mcp-config" ||
          arg.startsWith("--mcp-config=") ||
          arg === "--mcp-config-file" ||
          arg.startsWith("--mcp-config-file="),
      )
    )
      throw Error("Cold internal MCP configuration must be exclusive");
    const file = await open(
      tokenPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let accessToken: string;
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.size < 1 ||
        info.size > 65536 ||
        (info.mode & 0o077) !== 0 ||
        (process.getuid && info.uid !== process.getuid())
      )
        throw Error("Worker credential file is not owner-private");
      const bytes = Buffer.alloc(65537);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      accessToken = bytes.subarray(0, bytesRead).toString("utf8");
      if (bytesRead > 65536 || !accessToken || /[\r\n\0]/.test(accessToken))
        throw Error("Invalid Worker credential");
    } finally {
      await file.close();
    }
    directory = await mkdtemp(join(tmpdir(), "loom-cmcp-"));
    const transportNonce = randomUUID();
    bridge = await (
      provider === "claude"
        ? createClaudeColdWorkerMcpBridge
        : createKimiColdWorkerMcpBridge
    )({
      socketPath: join(directory, "bridge.sock"),
      workerApiOrigin: origin,
      transportNonce,
      binding: { runAttemptId, accessToken, isActive: () => active },
    });
    const config = {
      mcpServers: {
        loom_worker: {
          command: process.execPath,
          args: [
            fileURLToPath(new URL("./worker-mcp-entry.ts", import.meta.url)),
          ],
        },
      },
    };
    const configPath = join(directory, "mcp.json");
    if (provider === "kimi")
      await writeFile(configPath, JSON.stringify(config), {
        mode: 0o600,
        flag: "wx",
      });
    return {
      ...lease,
      env: {
        ...lease.env,
        ...bridge.env,
        ...(provider === "kimi"
          ? {
              LOOM_WORKER_MCP_IDENTITY: "cold-stdio/v1",
              LOOM_WORKER_MCP_NONCE: transportNonce,
            }
          : {}),
      },
      args: [
        ...(lease.args ?? []),
        ...(provider === "claude"
          ? ["--mcp-config", JSON.stringify(config)]
          : ["--mcp-config-file", configPath]),
      ],
      redactions: [
        ...(lease.redactions ?? []),
        bridge.env.LOOM_WORKER_MCP_SECRET,
      ],
      release,
    };
  } catch (error) {
    await release();
    throw error;
  }
}

export const claudeWorkerMcpLease = (
  runAttemptId: string,
  lease: ActivationEnvironmentLease,
) => coldWorkerMcpLease("claude", runAttemptId, lease);
export const kimiWorkerMcpLease = (
  runAttemptId: string,
  lease: ActivationEnvironmentLease,
) => coldWorkerMcpLease("kimi", runAttemptId, lease);
