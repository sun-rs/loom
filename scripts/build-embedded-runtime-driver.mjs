import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "rolldown";

const NODE_IMPORT =
  /^import\s+\{\s*([^}]+?)\s*\}\s+from\s+"(node:[^"]+)";\n/gmu;
const MAX_DRIVER_SOURCE_BYTES = 512 * 1_024;

/** Wraps one audited ESM/TLA driver as an async CommonJS SEA asset. */
export async function buildEmbeddedRuntimeDriverAsset(input) {
  const entrySource = await readFile(input.sourcePath, "utf8");
  const sourceBytes = Buffer.byteLength(entrySource, "utf8");
  if (sourceBytes <= 0 || sourceBytes > MAX_DRIVER_SOURCE_BYTES) {
    throw new Error(`${input.kind} runtime driver source size is invalid`);
  }
  const source = await bundleRuntimeDriverSource(input);
  if (Buffer.byteLength(source, "utf8") > MAX_DRIVER_SOURCE_BYTES) {
    throw new Error(`${input.kind} bundled runtime driver is too large`);
  }
  const imports = [];
  const body = source
    .replace(NODE_IMPORT, (_statement, bindings, specifier) => {
      const normalized = bindings.replaceAll(/\s+/gu, " ").trim();
      if (
        !/^[A-Za-z_$][A-Za-z0-9_$]*(?: *, *[A-Za-z_$][A-Za-z0-9_$]*)*$/u.test(
          normalized,
        )
      ) {
        throw new Error(`${input.kind} runtime driver has unsupported imports`);
      }
      imports.push({ bindings: normalized, specifier });
      return "";
    })
    // Rolldown preserves an empty export marker when an ESM entry's local
    // exports were tree-shaken into the same chunk. It carries no authority
    // and must be removed before wrapping the body as an async CJS asset.
    .replace(/^\s*export\s*\{\s*\};?\s*$/gmu, "");
  if (/^\s*(?:import|export)\b/mu.test(body)) {
    throw new Error(
      `${input.kind} runtime driver must use only named node: imports`,
    );
  }
  const requires = imports
    .map(
      ({ bindings, specifier }) =>
        `const { ${bindings} } = require(${JSON.stringify(specifier)});`,
    )
    .join("\n");
  const wrapped = `"use strict";
${requires}
module.exports = async function runEmbeddedProviderDriver(arguments_) {
  const originalArgv = process.argv;
  process.argv = [originalArgv[0], originalArgv[1], ${JSON.stringify(input.internalCommand)}, ...arguments_];
  process.exitCode = undefined;
  try {
${body}
    return process.exitCode === 1 ? 1 : 0;
  } finally {
    process.argv = originalArgv;
  }
};
`;
  auditEmbeddedRuntimeDriverRequires(wrapped, input.kind);
  await writeFile(input.outputPath, wrapped, { mode: 0o600 });
  return input.outputPath;
}

async function bundleRuntimeDriverSource(input) {
  const directory = await mkdtemp(join(tmpdir(), "rah-runtime-driver-"));
  try {
    const result = await build({
      external: /^node:/u,
      input: input.sourcePath,
      output: {
        dir: directory,
        entryFileNames: "driver.mjs",
        format: "esm",
        minify: false,
        sourcemap: false,
      },
      platform: "node",
      treeshake: true,
    });
    if (
      result.output.length !== 1 ||
      result.output[0].type !== "chunk" ||
      result.output[0].fileName !== "driver.mjs"
    ) {
      throw new Error(`${input.kind} runtime driver must bundle to one chunk`);
    }
    return await readFile(join(directory, "driver.mjs"), "utf8");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function auditEmbeddedRuntimeDriverRequires(source, kind) {
  const calls = [...source.matchAll(/\brequire\(([^)]+)\)/gu)];
  for (const call of calls) {
    let specifier;
    try {
      specifier = JSON.parse(call[1]);
    } catch {
      throw new Error(`${kind} embedded driver has a dynamic require`);
    }
    if (typeof specifier !== "string" || !specifier.startsWith("node:")) {
      throw new Error(`${kind} embedded driver requires a non-built-in module`);
    }
  }
}
