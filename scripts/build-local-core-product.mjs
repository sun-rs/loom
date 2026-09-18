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
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "rolldown";

import { compareComputerReleaseVersions } from "../packages/agent-host/src/computer-release-source.ts";
import { buildEmbeddedRuntimeDriverAsset } from "./build-embedded-runtime-driver.mjs";
import {
  BUILD_IDENTITY_META_NAME,
  buildIdentitiesAgree,
  decodeBuildIdentityMeta,
  parseBuildIdentity,
  resolveBuildIdentity,
} from "./release-version.mjs";
import { snapshotWorkbenchAssets } from "./workbench-web-assets.mjs";

const execFileAsync = promisify(execFile);
const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreEntryPath = join(
  rootDirectory,
  "packages/daemon/src/local-core-cli.ts",
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

export async function buildLocalCoreProduct(input) {
  const outputPath = absolutePath(input.outputPath, "outputPath");
  const carrierExecutablePath = absolutePath(
    input.carrierExecutablePath ?? process.execPath,
    "carrierExecutablePath",
  );
  const version = releaseVersion(input.version);
  // One release identity for this artefact. A formal product build refuses to
  // run without an explicit release version; it never falls back to 0.0.0 and
  // never asks the Git working tree who it is.
  const buildIdentity = adoptOrResolveBuildIdentity(
    version,
    input,
    process.env.RAH_OS_BUILD_IDENTITY,
  );
  const signIdentity = requiredText(input.signIdentity ?? "-", "signIdentity");
  const outputParent = dirname(outputPath);
  await ensureOutputParent(outputParent);
  await assertAbsent(outputPath);
  await assertSeaCarrier(carrierExecutablePath);
  const webBuildPath = await snapshotWorkbenchAssets(rootDirectory);
  await assertWebBuild(webBuildPath, buildIdentity);
  const stagingPath = await mkdtemp(
    join(outputParent, ".rah-os-local-core-build-"),
  );
  let published = false;
  try {
    const bundleDirectory = join(stagingPath, ".bundle");
    const binaryDirectory = join(stagingPath, "bin");
    const productWebPath = join(stagingPath, "web");
    await mkdir(bundleDirectory, { mode: 0o700 });
    await mkdir(binaryDirectory, { mode: 0o755 });

    const bundlePath = await bundleCore(bundleDirectory, buildIdentity);
    const supervisorPath = await bundleProcessSupervisor(bundleDirectory);
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
    const executablePath = join(binaryDirectory, "rah-os-core");
    const seaConfigurationPath = join(bundleDirectory, "sea-config.json");
    await writeFile(
      seaConfigurationPath,
      `${JSON.stringify({
        assets: {
          "claude-stream-json-driver.cjs": claudeDriverPath,
          "codex-app-server-driver.cjs": codexDriverPath,
          "kimi-acp-driver.cjs": kimiDriverPath,
          "opencode-server-driver.cjs": openCodeDriverPath,
          "process-supervisor.cjs": supervisorPath,
        },
        disableExperimentalSEAWarning: true,
        execArgvExtension: "none",
        executable: carrierExecutablePath,
        main: bundlePath,
        mainFormat: "module",
        output: executablePath,
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
        executablePath,
      ]);
      await run("/usr/bin/codesign", ["--verify", "--strict", executablePath]);
    }
    await chmod(executablePath, 0o500);
    await copyRegularTree(webBuildPath, productWebPath);
    await rm(bundleDirectory, { force: true, recursive: true });

    const executable = await fileDescriptor(stagingPath, executablePath);
    const webFiles = await describeTree(stagingPath, productWebPath);
    const carrierVersion = (
      await run(carrierExecutablePath, ["--version"])
    ).stdout.trim();
    const manifest = Object.freeze({
      executable,
      nodeCarrierVersion: carrierVersion,
      platformKey: `${process.platform}-${process.arch}`,
      product: "rah-os-local-core",
      schemaVersion: 1,
      version,
      web: Object.freeze({ files: webFiles, root: "web" }),
    });
    await writeFile(
      join(stagingPath, "product-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o444 },
    );
    await syncTree(stagingPath);
    await rename(stagingPath, outputPath);
    published = true;
    await syncDirectory(outputParent);
    return Object.freeze({ ...manifest, path: outputPath });
  } finally {
    if (!published) await rm(stagingPath, { force: true, recursive: true });
  }
}

async function bundleCore(bundleDirectory, buildIdentity) {
  const result = await build({
    define: {
      // Freeze the identity into the bundle so the shipped Core reports it
      // without reading the environment it happens to start in.
      "process.env.RAH_OS_BUILD_IDENTITY": JSON.stringify(
        JSON.stringify(buildIdentity),
      ),
    },
    external: /^node:/u,
    input: coreEntryPath,
    output: {
      dir: bundleDirectory,
      entryFileNames: "local-core.mjs",
      format: "esm",
      minify: false,
      sourcemap: false,
    },
    platform: "node",
    treeshake: true,
  });
  const chunks = result.output.filter((entry) => entry.type === "chunk");
  if (
    result.output.length !== 1 ||
    chunks.length !== 1 ||
    chunks[0].fileName !== "local-core.mjs"
  ) {
    throw new Error("Local Core SEA bundle must contain exactly one ESM chunk");
  }
  return join(bundleDirectory, "local-core.mjs");
}

async function bundleProcessSupervisor(bundleDirectory) {
  const result = await build({
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
    result.output.length !== 1 ||
    result.output[0].type !== "chunk" ||
    result.output[0].fileName !== "process-supervisor.cjs"
  ) {
    throw new Error("Local Core supervisor must be one CommonJS chunk");
  }
  const path = join(bundleDirectory, "process-supervisor.cjs");
  auditProcessSupervisorRequires(await readFile(path, "utf8"));
  return path;
}

async function copyRegularTree(sourceRoot, destinationRoot) {
  await mkdir(destinationRoot, { mode: 0o755 });
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const source = join(sourceRoot, entry.name);
    const destination = join(destinationRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("Web build must not contain symbolic links");
    }
    if (entry.isDirectory()) {
      await copyRegularTree(source, destination);
    } else if (entry.isFile()) {
      await copyFile(source, destination, constants.COPYFILE_EXCL);
      await chmod(destination, 0o444);
    } else {
      throw new Error("Web build must contain only regular files");
    }
  }
}

async function describeTree(productRoot, directory) {
  const descriptors = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      descriptors.push(...(await describeTree(productRoot, path)));
    } else if (entry.isFile()) {
      descriptors.push(await fileDescriptor(productRoot, path));
    } else {
      throw new Error("Product tree must contain only regular files");
    }
  }
  return Object.freeze(
    descriptors.sort((left, right) => left.path.localeCompare(right.path)),
  );
}

async function fileDescriptor(productRoot, path) {
  const bytes = await readFile(path);
  return Object.freeze({
    path: relative(productRoot, path).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  });
}

async function assertWebBuild(path, buildIdentity) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("production Web build is missing");
  }
  const indexPath = join(path, "index.html");
  const index = await lstat(indexPath);
  if (!index.isFile() || index.isSymbolicLink() || index.size < 1) {
    throw new Error("production Web index is missing");
  }
  assertWebBuildIdentity(await readFile(indexPath, "utf8"), buildIdentity);
}

// One release identity per build. An identity already resolved by the operator
// (`RAH_OS_BUILD_IDENTITY`, the same value the Web build consumed) wins, so the
// Web bundle and the Core agree byte for byte. It must still name the release
// version this invocation was told to build.
function adoptOrResolveBuildIdentity(version, input, injected) {
  if (injected !== undefined && injected !== "") {
    const adopted = parseBuildIdentity(injected);
    if (adopted.kind !== "release" || adopted.releaseVersion !== version) {
      throw new Error(
        `RAH_OS_BUILD_IDENTITY names ${adopted.version}, not the requested release ${version}`,
      );
    }
    if (input.commit !== undefined && adopted.commit !== input.commit) {
      throw new Error(
        "RAH_OS_BUILD_IDENTITY commit does not match the requested --commit",
      );
    }
    return adopted;
  }
  return resolveBuildIdentity({
    mode: "formal",
    releaseVersion: version,
    ...(input.commit === undefined ? {} : { commit: input.commit }),
    ...(input.builtAt === undefined ? {} : { builtAt: input.builtAt }),
  });
}

// The Web bundle is built before this script runs. A product may only ship a
// Web bundle that carries the same release identity as the Core it is packaged
// with; a development bundle is refused instead of being relabelled.
export function assertWebBuildIdentity(index, buildIdentity) {
  const matches = Array.from(
    index.matchAll(
      new RegExp(
        `<meta\\s+name=["']${BUILD_IDENTITY_META_NAME}["']\\s+content=["']([^"']+)["']\\s*/?\\s*>`,
        "giu",
      ),
    ),
    (match) => match[1],
  );
  if (matches.length !== 1) {
    throw new Error(
      "production Web build carries no release identity; rebuild it with RAH_OS_BUILD_IDENTITY",
    );
  }
  const webIdentity = decodeBuildIdentityMeta(matches[0]);
  if (webIdentity === undefined) {
    throw new Error("production Web build release identity is invalid");
  }
  if (webIdentity.kind !== "release") {
    throw new Error(
      "production Web build is a development bundle; rebuild it with an explicit release version",
    );
  }
  // Full identity equality, not just the version: two builds of the same commit
  // are still two different artefacts, and the acceptance check after a restart
  // compares buildId. Export RAH_OS_BUILD_IDENTITY once and reuse it for both
  // the Web build and this one.
  if (!buildIdentitiesAgree(webIdentity, buildIdentity)) {
    throw new Error(
      `production Web build identity (${webIdentity.version}, build ${webIdentity.buildId}) does not match the Core identity (${buildIdentity.version}, build ${buildIdentity.buildId}); resolve one identity with scripts/release-version.mjs and export RAH_OS_BUILD_IDENTITY for both builds`,
    );
  }
}

async function ensureOutputParent(path) {
  await mkdir(path, { mode: 0o755, recursive: true });
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o022) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error("Local Core output parent is not owner-controlled");
  }
}

async function assertAbsent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return;
    throw error;
  }
  throw new Error("Local Core product output already exists");
}

async function assertSeaCarrier(path) {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o111) === 0 ||
    (metadata.mode & 0o022) !== 0
  ) {
    throw new Error("Local Core SEA carrier executable is invalid");
  }
  const bytes = await readFile(path);
  if (
    !bytes.includes(
      Buffer.from("NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0"),
    )
  ) {
    throw new Error("Local Core SEA carrier has no unused SEA fuse");
  }
  const platform = (
    await run(path, ["-p", "`${process.platform}-${process.arch}`"])
  ).stdout.trim();
  if (platform !== `${process.platform}-${process.arch}`) {
    throw new Error(
      "Local Core SEA carrier platform does not match the builder",
    );
  }
}

function auditProcessSupervisorRequires(source) {
  const requireCall = /\brequire\((['"])([^'"]+)\1\)/gu;
  let observed = 0;
  for (const match of source.matchAll(requireCall)) {
    observed += 1;
    if (!match[2].startsWith("node:")) {
      throw new Error("Local Core supervisor contains a non-builtin require");
    }
  }
  if (observed === 0 || /\brequire\((?!['"])/u.test(source)) {
    throw new Error("Local Core supervisor require closure is invalid");
  }
}

async function run(executablePath, arguments_) {
  return await execFileAsync(executablePath, arguments_, {
    env: Object.create(null),
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
  });
}

async function syncTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await syncTree(path);
    else if (entry.isFile()) await syncFile(path);
  }
  await syncDirectory(directory);
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
    value.length > 4096
  ) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}

function releaseVersion(value) {
  if (typeof value !== "string") throw new Error("version is invalid");
  compareComputerReleaseVersions(value, value);
  return value;
}

function requiredText(value, name) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.includes("\0")
  ) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseArguments(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (
      (key !== "--output" &&
        key !== "--carrier" &&
        key !== "--commit" &&
        key !== "--built-at" &&
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
    builtAt: parsed.get("--built-at"),
    carrierExecutablePath: parsed.get("--carrier"),
    commit: parsed.get("--commit"),
    outputPath: parsed.get("--output"),
    signIdentity: parsed.get("--sign-identity"),
    version: parsed.get("--version"),
  };
}

function usage() {
  return new Error(
    "usage: build-local-core-product --output <absolute-directory> --version <semver> [--commit <sha>] [--built-at <iso8601>] [--carrier <absolute-node>] [--sign-identity <identity>]",
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await buildLocalCoreProduct(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
