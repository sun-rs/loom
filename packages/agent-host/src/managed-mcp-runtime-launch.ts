import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  ManagedMcpCatalogSchema,
  ManagedMcpRuntimeAdapterSchema,
  type ManagedMcpRuntimeAdapter,
} from "@rah-os/protocol";

import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";
import {
  assertNoNativeManagedMcpToolNameCollisions,
  type ManagedMcpRuntimeProxyRegistry,
  type ManagedMcpWorkerClient,
} from "./managed-mcp-runtime-proxy.ts";

const OPENCODE_CONFIG_CONTENT = "OPENCODE_CONFIG_CONTENT";
const MAX_OPENCODE_CONFIG_BYTES = 256 * 1_024;

export async function prepareManagedMcpRuntimeLaunch(input: {
  adapter: ManagedMcpRuntimeAdapter;
  client: ManagedMcpWorkerClient;
  existingEnvironment?: Readonly<Record<string, string>>;
  registry: ManagedMcpRuntimeProxyRegistry;
  temporaryDirectory: string;
}): Promise<ActivationEnvironmentLease> {
  const adapter = ManagedMcpRuntimeAdapterSchema.parse(input.adapter);
  try {
    const catalog = ManagedMcpCatalogSchema.parse(
      await input.client.loadCatalog(),
    );
    assertNoNativeManagedMcpToolNameCollisions(catalog.tools);
  } catch {
    return Object.freeze({
      args: Object.freeze([]),
      diagnostics: Object.freeze([
        "Managed MCP discovery unavailable [reason=discovery_failed]",
      ]),
      env: Object.freeze({}),
    });
  }

  let registration;
  try {
    registration = await input.registry.register(input.client);
  } catch {
    return Object.freeze({
      args: Object.freeze([]),
      diagnostics: Object.freeze([
        "Managed MCP discovery unavailable [reason=proxy_unavailable]",
      ]),
      env: Object.freeze({}),
    });
  }

  let launchDirectory: string | undefined;
  try {
    let args: readonly string[] = [];
    const env: Record<string, string> = loopbackNoProxyEnvironment(
      input.existingEnvironment,
    );
    if (adapter.kind === "codex-cli/v1") {
      args = [
        "-c",
        `mcp_servers.${registration.name}.url=${JSON.stringify(registration.url)}`,
      ];
    } else if (adapter.kind === "opencode-cli/v1") {
      const existing = parseOpenCodeConfig(
        input.existingEnvironment?.[OPENCODE_CONFIG_CONTENT],
      );
      env[OPENCODE_CONFIG_CONTENT] = JSON.stringify({
        ...existing,
        mcp: {
          ...recordField(existing.mcp),
          [registration.name]: {
            enabled: true,
            type: "remote",
            url: registration.url,
          },
        },
      });
    } else {
      launchDirectory = await createPrivateLaunchDirectory(
        input.temporaryDirectory,
      );
      const configPath = join(launchDirectory, "mcp.json");
      const content =
        adapter.kind === "claude-cli/v1"
          ? {
              mcpServers: {
                [registration.name]: {
                  type: "http",
                  url: registration.url,
                },
              },
            }
          : {
              mcpServers: {
                [registration.name]: {
                  transport: "http",
                  url: registration.url,
                },
              },
            };
      await writeFile(configPath, JSON.stringify(content), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      args = [
        adapter.kind === "claude-cli/v1" ? "--mcp-config" : "--mcp-config-file",
        configPath,
      ];
    }
    let released = false;
    return Object.freeze({
      args: Object.freeze([...args]),
      env: Object.freeze(env),
      release: async () => {
        if (released) return;
        released = true;
        const outcomes = await Promise.allSettled([
          registration.release(),
          launchDirectory === undefined
            ? undefined
            : rm(launchDirectory, { force: true, recursive: true }),
        ]);
        const failures = outcomes.flatMap((outcome) =>
          outcome.status === "rejected" ? [outcome.reason] : [],
        );
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(
            failures,
            "managed MCP Runtime launch cleanup failed",
          );
        }
      },
    });
  } catch (error) {
    const cleanup = await Promise.allSettled([
      registration.release(),
      launchDirectory === undefined
        ? undefined
        : rm(launchDirectory, { force: true, recursive: true }),
    ]);
    const failures = cleanup.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(
        [error, ...failures],
        "managed MCP Runtime launch setup and cleanup failed",
      );
    }
    throw error;
  }
}

async function createPrivateLaunchDirectory(base: string): Promise<string> {
  const directory = resolve(base);
  await mkdir(directory, { mode: 0o700, recursive: true });
  const metadata = await lstat(directory);
  const currentUid = process.getuid?.();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (currentUid !== undefined && metadata.uid !== currentUid) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error(
      "managed MCP temporary directory is not private and owner-controlled",
    );
  }
  await access(directory, constants.W_OK | constants.X_OK);
  return await mkdtemp(join(directory, "launch-"));
}

function loopbackNoProxyEnvironment(
  existing: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const additions = ["127.0.0.1", "localhost", "::1", "[::1]"];
  const merge = (value: string | undefined) =>
    [...new Set([...(value?.split(",") ?? []), ...additions])]
      .filter((entry) => entry.length > 0)
      .join(",");
  return {
    NO_PROXY: merge(existing?.NO_PROXY),
    no_proxy: merge(existing?.no_proxy),
  };
}

function parseOpenCodeConfig(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw.trim() === "") return {};
  if (Buffer.byteLength(raw) > MAX_OPENCODE_CONFIG_BYTES) {
    throw new Error("OpenCode config content exceeds the safe byte limit");
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("OpenCode config content must be a JSON object");
  }
  return parsed;
}

function recordField(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
