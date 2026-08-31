import { createRequire } from "node:module";
import { getAsset, isSea } from "node:sea";

const PROCESS_SUPERVISOR_ASSET = "process-supervisor.cjs";
const MAX_PROCESS_SUPERVISOR_ASSET_BYTES = 256 * 1_024;

export type EmbeddedProcessSupervisorRuntime = Readonly<{
  getAsset?: (key: string, encoding: "utf8") => string;
  executeModule?: (source: string) => void;
  isSea?: () => boolean;
}>;

/**
 * Executes the audited process-group supervisor source embedded in the
 * Computer SEA. The build audits the bundled CommonJS asset so every require
 * targets a Node built-in. Evaluation receives an explicit built-in-capable
 * require and performs no runtime filesystem lookup or adjacent-file load.
 */
export async function runEmbeddedProcessSupervisor(
  runtime: EmbeddedProcessSupervisorRuntime = {},
): Promise<0> {
  const runningInSea = runtime.isSea ?? isSea;
  if (!runningInSea()) {
    throw new Error(
      "embedded process supervisor is only available inside the Computer SEA",
    );
  }
  const readAsset = runtime.getAsset ?? getAsset;
  const source = readAsset(PROCESS_SUPERVISOR_ASSET, "utf8");
  const byteLength = Buffer.byteLength(source, "utf8");
  if (byteLength <= 0 || byteLength > MAX_PROCESS_SUPERVISOR_ASSET_BYTES) {
    throw new Error("embedded process supervisor asset size is invalid");
  }
  const executeModule = runtime.executeModule ?? executeCommonJsModule;
  executeModule(source);
  return 0;
}

function executeCommonJsModule(source: string): void {
  const module = { exports: {} };
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
}
