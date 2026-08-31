import { createRequire } from "node:module";
import { getAsset, isSea } from "node:sea";

export type EmbeddedRuntimeDriverKind =
  "claude-stream-json" | "codex-app-server" | "kimi-acp" | "opencode-server";

const DRIVER_ASSETS: Readonly<Record<EmbeddedRuntimeDriverKind, string>> = {
  "claude-stream-json": "claude-stream-json-driver.cjs",
  "codex-app-server": "codex-app-server-driver.cjs",
  "kimi-acp": "kimi-acp-driver.cjs",
  "opencode-server": "opencode-server-driver.cjs",
};
const MAX_RUNTIME_DRIVER_ASSET_BYTES = 512 * 1_024;

export type EmbeddedRuntimeDriverRuntime = Readonly<{
  getAsset?: (key: string, encoding: "utf8") => string;
  executeModule?: (
    source: string,
    arguments_: readonly string[],
  ) => Promise<0 | 1>;
  isSea?: () => boolean;
}>;

/** Runs one audited Provider transport embedded in a self-contained SEA. */
export async function runEmbeddedRuntimeDriver(
  kind: EmbeddedRuntimeDriverKind,
  arguments_: readonly string[],
  runtime: EmbeddedRuntimeDriverRuntime = {},
): Promise<0 | 1> {
  const runningInSea = runtime.isSea ?? isSea;
  if (!runningInSea()) {
    throw new Error("embedded runtime drivers are only available inside a SEA");
  }
  const asset = DRIVER_ASSETS[kind];
  if (asset === undefined) throw new Error(`unknown runtime driver: ${kind}`);
  const source = (runtime.getAsset ?? getAsset)(asset, "utf8");
  const byteLength = Buffer.byteLength(source, "utf8");
  if (byteLength <= 0 || byteLength > MAX_RUNTIME_DRIVER_ASSET_BYTES) {
    throw new Error(`embedded ${kind} runtime driver asset size is invalid`);
  }
  return await (runtime.executeModule ?? executeCommonJsModule)(
    source,
    arguments_,
  );
}

async function executeCommonJsModule(
  source: string,
  arguments_: readonly string[],
): Promise<0 | 1> {
  const module = { exports: {} as unknown };
  const execute = new Function(
    "require",
    "module",
    "exports",
    `"use strict";\n${source}`,
  ) as (
    require: NodeJS.Require,
    module: { exports: unknown },
    exports: unknown,
  ) => void;
  execute(createRequire(import.meta.url), module, module.exports);
  if (typeof module.exports !== "function") {
    throw new Error("embedded runtime driver did not export a function");
  }
  const run = module.exports as (
    arguments_: readonly string[],
  ) => Promise<0 | 1>;
  return await run(arguments_);
}
