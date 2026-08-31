#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "rolldown";

import { compareComputerReleaseVersions } from "../packages/agent-host/src/computer-release-source.ts";
import { buildEmbeddedRuntimeDriverAsset } from "./build-embedded-runtime-driver.mjs";

const execFileAsync = promisify(execFile);
const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const computerEntryPath = join(
  rootDirectory,
  "packages/agent-host/src/computer-cli.ts",
);
const processSupervisorAssetPath = join(
  rootDirectory,
  "packages/agent-host/src/process-supervisor.mjs",
);
const claudeStreamJsonDriverAssetPath = join(
  rootDirectory,
  "packages/agent-host/src/claude-stream-json-driver.mjs",
);
const codexAppServerDriverAssetPath = join(
  rootDirectory,
  "packages/agent-host/src/codex-app-server-driver.mjs",
);
const kimiAcpDriverAssetPath = join(
  rootDirectory,
  "packages/agent-host/src/kimi-acp-driver.mjs",
);
const openCodeServerDriverAssetPath = join(
  rootDirectory,
  "packages/agent-host/src/opencode-server-driver.mjs",
);
const buildVersionModulePath = join(
  rootDirectory,
  "packages/agent-host/src/computer-artifact-build-version.ts",
);
const virtualBuildVersionModule = "\0rah-os:computer-build-version";

export async function buildComputerSea(input) {
  const outputPath = absolutePath(input.outputPath, "outputPath");
  const carrierExecutablePath = absolutePath(
    input.carrierExecutablePath ?? process.execPath,
    "carrierExecutablePath",
  );
  const version = releaseVersion(input.version);
  const signIdentity = requiredText(input.signIdentity ?? "-", "signIdentity");
  await ensureOutputDirectory(dirname(outputPath));
  await assertSeaCarrier(carrierExecutablePath);
  const workDirectory = await mkdtemp(join(tmpdir(), "rah-computer-sea-"));
  try {
    const bundleDirectory = join(workDirectory, "bundle");
    await mkdir(bundleDirectory, { mode: 0o700 });
    const result = await build({
      external: /^node:/u,
      input: computerEntryPath,
      output: {
        dir: bundleDirectory,
        entryFileNames: "computer.mjs",
        format: "esm",
        minify: false,
        sourcemap: false,
      },
      platform: "node",
      plugins: [
        {
          load(id) {
            if (id !== virtualBuildVersionModule) return null;
            return `export const COMPUTER_ARTIFACT_BUILD_VERSION = ${JSON.stringify(version)};`;
          },
          name: "rah-os-computer-build-version",
          resolveId(source, importer) {
            if (importer === undefined) return null;
            if (resolve(dirname(importer), source) === buildVersionModulePath) {
              return virtualBuildVersionModule;
            }
            return null;
          },
        },
      ],
      treeshake: true,
    });
    const emitted = result.output.filter((entry) => entry.type === "chunk");
    if (
      result.output.length !== 1 ||
      emitted.length !== 1 ||
      emitted[0].fileName !== "computer.mjs"
    ) {
      throw new Error("Computer SEA bundle must contain exactly one ESM chunk");
    }
    const bundlePath = join(bundleDirectory, "computer.mjs");
    const bundleSource = await readFile(bundlePath, "utf8");
    if (
      bundleSource.includes("COMPUTER_ARTIFACT_BUILD_VERSION = void 0") ||
      !bundleSource.includes(JSON.stringify(version))
    ) {
      throw new Error("Computer SEA bundle did not freeze its build version");
    }
    const supervisorResult = await build({
      external: /^node:/u,
      input: processSupervisorAssetPath,
      output: {
        dir: bundleDirectory,
        entryFileNames: "process-supervisor.cjs",
        format: "cjs",
        minify: false,
        sourcemap: false,
      },
      platform: "node",
      treeshake: true,
    });
    if (
      supervisorResult.output.length !== 1 ||
      supervisorResult.output[0].type !== "chunk" ||
      supervisorResult.output[0].fileName !== "process-supervisor.cjs"
    ) {
      throw new Error(
        "Computer process supervisor asset must contain exactly one CommonJS chunk",
      );
    }
    const bundledProcessSupervisorPath = join(
      bundleDirectory,
      "process-supervisor.cjs",
    );
    const supervisorSource = await readFile(
      bundledProcessSupervisorPath,
      "utf8",
    );
    auditProcessSupervisorRequires(supervisorSource);
    const claudeDriverPath = await buildEmbeddedRuntimeDriverAsset({
      internalCommand: "__claude-stream-json-driver",
      kind: "claude-stream-json",
      outputPath: join(bundleDirectory, "claude-stream-json-driver.cjs"),
      sourcePath: claudeStreamJsonDriverAssetPath,
    });
    const codexDriverPath = await buildEmbeddedRuntimeDriverAsset({
      internalCommand: "__codex-app-server-driver",
      kind: "codex-app-server",
      outputPath: join(bundleDirectory, "codex-app-server-driver.cjs"),
      sourcePath: codexAppServerDriverAssetPath,
    });
    const kimiDriverPath = await buildEmbeddedRuntimeDriverAsset({
      internalCommand: "__kimi-acp-driver",
      kind: "kimi-acp",
      outputPath: join(bundleDirectory, "kimi-acp-driver.cjs"),
      sourcePath: kimiAcpDriverAssetPath,
    });
    const openCodeDriverPath = await buildEmbeddedRuntimeDriverAsset({
      internalCommand: "__opencode-server-driver",
      kind: "opencode-server",
      outputPath: join(bundleDirectory, "opencode-server-driver.cjs"),
      sourcePath: openCodeServerDriverAssetPath,
    });
    const stagedExecutablePath = join(workDirectory, "rah-os-computer");
    const seaConfigurationPath = join(workDirectory, "sea-config.json");
    await writeFile(
      seaConfigurationPath,
      `${JSON.stringify({
        assets: {
          "claude-stream-json-driver.cjs": claudeDriverPath,
          "codex-app-server-driver.cjs": codexDriverPath,
          "kimi-acp-driver.cjs": kimiDriverPath,
          "opencode-server-driver.cjs": openCodeDriverPath,
          "process-supervisor.cjs": bundledProcessSupervisorPath,
        },
        disableExperimentalSEAWarning: true,
        execArgvExtension: "none",
        executable: carrierExecutablePath,
        main: bundlePath,
        mainFormat: "module",
        output: stagedExecutablePath,
        useCodeCache: false,
        useSnapshot: false,
      })}\n`,
      { mode: 0o600 },
    );
    await run(carrierExecutablePath, ["--build-sea", seaConfigurationPath]);
    if (process.platform === "darwin") {
      await run("/usr/bin/codesign", [
        "--force",
        "--sign",
        signIdentity,
        "--timestamp=none",
        stagedExecutablePath,
      ]);
      await run("/usr/bin/codesign", [
        "--verify",
        "--strict",
        stagedExecutablePath,
      ]);
    }
    await chmod(stagedExecutablePath, 0o500);
    await copyFile(stagedExecutablePath, outputPath, constants.COPYFILE_EXCL);
    await chmod(outputPath, 0o500);
    await syncFile(outputPath);
    await syncDirectory(dirname(outputPath));
    const bytes = await readFile(outputPath);
    return Object.freeze({
      file: basename(outputPath),
      nodeCarrierVersion: (
        await run(carrierExecutablePath, ["--version"])
      ).stdout.trim(),
      path: outputPath,
      platformKey: `${process.platform}-${process.arch}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength,
      version,
    });
  } finally {
    await rm(workDirectory, { force: true, recursive: true });
  }
}

function parseArguments(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (
      (key !== "--output" &&
        key !== "--carrier" &&
        key !== "--sign-identity" &&
        key !== "--version") ||
      value === undefined ||
      parsed.has(key)
    ) {
      throw usage();
    }
    parsed.set(key, value);
  }
  if (!parsed.has("--output") || !parsed.has("--version")) throw usage();
  return {
    carrierExecutablePath: parsed.get("--carrier"),
    outputPath: parsed.get("--output"),
    signIdentity: parsed.get("--sign-identity"),
    version: parsed.get("--version"),
  };
}

async function ensureOutputDirectory(path) {
  await mkdir(path, { mode: 0o755, recursive: true });
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o022) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error("Computer SEA output directory is not owner-controlled");
  }
}

async function run(executablePath, arguments_) {
  return await execFileAsync(executablePath, arguments_, {
    env: Object.create(null),
    maxBuffer: 4 * 1_024 * 1_024,
    timeout: 120_000,
    windowsHide: true,
  });
}

async function assertSeaCarrier(executablePath) {
  const metadata = await lstat(executablePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o111) === 0 ||
    (metadata.mode & 0o022) !== 0
  ) {
    throw new Error("Computer SEA carrier executable is invalid");
  }
  const bytes = await readFile(executablePath);
  if (
    !bytes.includes(
      Buffer.from("NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0", "utf8"),
    )
  ) {
    throw new Error(
      "Computer SEA carrier has no unused SEA fuse; use a pinned upstream Node binary",
    );
  }
  const { stdout } = await run(executablePath, [
    "-p",
    "`${process.platform}-${process.arch}`",
  ]);
  if (stdout.trim() !== `${process.platform}-${process.arch}`) {
    throw new Error("Computer SEA carrier platform does not match the builder");
  }
}

function auditProcessSupervisorRequires(source) {
  const requireCall = /\brequire\((['"])([^'"]+)\1\)/gu;
  let observed = 0;
  for (const match of source.matchAll(requireCall)) {
    observed += 1;
    if (!match[2].startsWith("node:")) {
      throw new Error(
        "Computer process supervisor asset contains a non-builtin require",
      );
    }
  }
  if (observed === 0 || /\brequire\((?!['"])/u.test(source)) {
    throw new Error("Computer process supervisor require closure is invalid");
  }
}

async function syncFile(path) {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function absolutePath(value, name) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.length > 4_096
  ) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}

function releaseVersion(value) {
  if (typeof value !== "string") throw new Error("version is invalid");
  try {
    compareComputerReleaseVersions(value, value);
  } catch {
    throw new Error("version must be strict semver");
  }
  return value;
}

function requiredText(value, name) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function usage() {
  return new Error(
    "usage: build-computer-sea --version <semver> --output <absolute-path> [--carrier <upstream-node-path>] [--sign-identity <codesign-identity>]",
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await buildComputerSea(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
