#!/usr/bin/env node

import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildComputerSea } from "./build-computer-sea.mjs";
import { fetchPinnedComputerSeaCarrier } from "./fetch-computer-sea-carrier.mjs";
import {
  ComputerReleaseSource,
  createMacOSComputerProvisioning,
  installMacOSComputerLaunchAgentFiles,
  publishComputerRelease,
} from "../packages/agent-host/src/index.ts";

const directory = await mkdtemp(join(tmpdir(), "rah-computer-sea-gate-"));
try {
  const outputPath = join(directory, "rah-os-computer");
  const carrier = await fetchPinnedComputerSeaCarrier({
    outputDirectory: join(directory, "carrier"),
  });
  const descriptor = await buildComputerSea({
    carrierExecutablePath: carrier.executablePath,
    outputPath,
    signIdentity: "-",
    version: "0.0.1-gate",
  });
  const metadata = await lstat(outputPath);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o500) {
    throw new Error("Computer SEA does not have the exact executable mode");
  }

  const invalid = await run(outputPath, ["--invalid"], false);
  if (
    invalid.exitCode === 0 ||
    !invalid.stderr.includes("usage: rah-os-computer")
  ) {
    throw new Error("Computer SEA did not execute the bundled CLI dispatcher");
  }

  const workerCli = await run(
    outputPath,
    ["__worker-cli", "worker", "help"],
    false,
  );
  if (
    workerCli.exitCode !== 0 ||
    !workerCli.stdout.includes("loom-worker sync") ||
    !workerCli.stdout.includes("loom-worker task-submit")
  ) {
    throw new Error(
      `Computer SEA did not execute its embedded Worker CLI: exit=${String(workerCli.exitCode)} stdout=${JSON.stringify(workerCli.stdout)} stderr=${JSON.stringify(workerCli.stderr)}`,
    );
  }

  const supervisor = await run(
    outputPath,
    ["__runtime-process-supervisor"],
    true,
  );
  if (
    supervisor.exitCode === 0 ||
    !supervisor.readiness.includes("RAH_PROCESS_SUPERVISOR_CONFIG")
  ) {
    throw new Error(
      `Computer SEA did not execute its embedded supervisor asset: exit=${String(supervisor.exitCode)} readiness=${JSON.stringify(supervisor.readiness)} stderr=${JSON.stringify(supervisor.stderr)}`,
    );
  }

  const fakeCodex = join(directory, "fake-codex-app-server.mjs");
  await writeFile(
    fakeCodex,
    `#!${process.execPath}
import { createInterface } from "node:readline";
if (process.argv.slice(2).join(" ") !== "app-server --listen stdio://") process.exit(64);
const lines = createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
lines.on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "initialize") send({jsonrpc:"2.0",id:frame.id,result:{userAgent:"sea-gate-codex/1"}});
  else if (frame.method === "thread/start") send({jsonrpc:"2.0",id:frame.id,result:{thread:{id:"sea-thread"}}});
  else if (frame.method === "turn/start") {
    send({jsonrpc:"2.0",id:frame.id,result:{turn:{id:"sea-turn",status:"inProgress"}}});
    send({jsonrpc:"2.0",method:"turn/completed",params:{threadId:"sea-thread",turn:{id:"sea-turn",status:"completed"}}});
  }
});
`,
    { mode: 0o700 },
  );
  await chmod(fakeCodex, 0o700);
  const nativeDriver = await run(
    outputPath,
    [
      "__codex-app-server-driver",
      "--executable",
      fakeCodex,
      "--tool-access-mode",
      "full_access",
      "--prompt",
      "complete the SEA gate",
    ],
    false,
  );
  if (nativeDriver.exitCode !== 0) {
    throw new Error(
      `Computer SEA did not execute its embedded Codex driver: exit=${String(nativeDriver.exitCode)} stdout=${JSON.stringify(nativeDriver.stdout)} stderr=${JSON.stringify(nativeDriver.stderr)}`,
    );
  }

  const fakeClaude = join(directory, "fake-claude-stream-json.mjs");
  await writeFile(
    fakeClaude,
    `#!${process.execPath}
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (!args.includes("--input-format") || !args.includes("stream-json") || !args.includes("--permission-mode") || args[args.indexOf("--permission-mode") + 1] !== "bypassPermissions") process.exit(64);
const lines = createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
lines.once("line", (line) => {
  const input = JSON.parse(line);
  const session_id = "sea-claude-session";
  send({...input,session_id});
  send({type:"system",subtype:"init",session_id});
  send({type:"assistant",session_id,message:{content:[{type:"text",text:"SEA Claude complete"}]}});
  send({type:"result",subtype:"success",is_error:false,result:"SEA Claude complete",session_id});
});
`,
    { mode: 0o700 },
  );
  await chmod(fakeClaude, 0o700);
  const claudeDriver = await run(
    outputPath,
    [
      "__claude-stream-json-driver",
      "--executable",
      fakeClaude,
      "--tool-access-mode",
      "full_access",
      "--prompt",
      "complete the Claude SEA gate",
    ],
    true,
  );
  const claudeFrames = claudeDriver.readiness
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const claudeSessionEvidence = claudeFrames.find(
    (frame) => frame.protocol === "rah-provider-session/v1",
  );
  const claudeTrajectory = claudeFrames.filter(
    (frame) => frame.protocol !== "rah-provider-session/v1",
  );
  if (
    claudeDriver.exitCode !== 0 ||
    claudeSessionEvidence?.providerSessionId !== "sea-claude-session" ||
    !JSON.stringify(claudeTrajectory).includes("SEA Claude complete") ||
    JSON.stringify(claudeTrajectory).includes("sea-claude-session")
  ) {
    throw new Error(
      `Computer SEA did not execute its embedded Claude driver with separated trajectory/session evidence: exit=${String(claudeDriver.exitCode)} trajectory=${JSON.stringify(claudeTrajectory)} session=${JSON.stringify(claudeSessionEvidence)} stderr=${JSON.stringify(claudeDriver.stderr)}`,
    );
  }

  const releaseKeyPair = generateKeyPairSync("ed25519");
  const releasePublicKeyPem = releaseKeyPair.publicKey
    .export({ format: "pem", type: "spki" })
    .toString();
  const releasePrivateKeyPath = join(directory, "release-private.pem");
  await writeFile(
    releasePrivateKeyPath,
    releaseKeyPair.privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 },
  );
  const releaseRoot = join(directory, "release-publication");
  const publication = await publishComputerRelease({
    privateKeyPath: releasePrivateKeyPath,
    rootDirectory: releaseRoot,
    targets: [
      {
        artifactPath: outputPath,
        file: "rah-os-computer-darwin-arm64",
        platformKey: "darwin-arm64",
      },
    ],
    version: descriptor.version,
  });
  const releaseSource = new ComputerReleaseSource({
    baseUrl: "https://releases.example.test/computer",
    fetch: async (input) => {
      const url = new URL(input.toString());
      const prefix = "/computer/";
      if (!url.pathname.startsWith(prefix))
        return new Response(null, { status: 404 });
      const segments = url.pathname
        .slice(prefix.length)
        .split("/")
        .filter((segment) => segment.length > 0);
      if (
        segments.length === 0 ||
        segments.some((segment) => segment === "." || segment === "..")
      ) {
        return new Response(null, { status: 404 });
      }
      try {
        return new Response(await readFile(join(releaseRoot, ...segments)), {
          headers: { "content-type": "application/json" },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    },
    publicKey: releaseKeyPair.publicKey,
  });
  const verifiedRelease = await releaseSource.fetchRelease(descriptor.version, {
    platformKey: "darwin-arm64",
  });
  if (
    verifiedRelease.file !== "rah-os-computer-darwin-arm64" ||
    verifiedRelease.sha256 !== descriptor.sha256 ||
    verifiedRelease.size !== descriptor.size ||
    publication.targets["darwin-arm64"]?.sha256 !== descriptor.sha256
  ) {
    throw new Error("Computer SEA signed publication round trip failed");
  }
  const installRoot = join(directory, "installed");
  const socketDirectory = `/tmp/rahc-sea-gate-${String(process.pid)}`;
  const provisioning = createMacOSComputerProvisioning({
    executableDirectory: join(installRoot, "bin"),
    label: "dev.rah-os.computer-sea-gate",
    logDirectory: join(installRoot, "logs"),
    plistPath: join(
      directory,
      "LaunchAgents",
      "dev.rah-os.computer-sea-gate.plist",
    ),
    privateConfigurationDirectory: join(installRoot, "private"),
    release: {
      baseUrl: "https://releases.example.test/computer",
      publicKeyPem: releasePublicKeyPem,
    },
    service: {
      activationLeaseMs: 30_000,
      attachmentReconcileIntervalMs: 5_000,
      buildVersion: descriptor.version,
      capacity: 1,
      controlRequestTimeoutMs: 5_000,
      runtimeProtocolVersion: 1,
      runtimeRegistryOwnerId: "computer-sea-gate-runtime-owner",
      runtimes: [
        {
          credentialBindings: {},
          offer: {
            leaseMs: 60_000,
            maxConcurrent: 1,
            runtimeOfferId: "computer-sea-gate-offer",
          },
          registryDatabasePath: join(installRoot, "runtime-registry.db"),
          runtimeProfileId: "computer-sea-gate-runtime",
        },
      ],
      workspace: {
        cwd: directory,
        mode: "in_place",
        workspaceDefinitionId: "computer-sea-gate-workspace",
        workspaceMountDigest: `sha256:${"a".repeat(64)}`,
        workspaceMountRevisionId: "computer-sea-gate-mount-v1",
      },
    },
    socketDirectory,
    stateDirectory: join(installRoot, "state"),
  });
  try {
    const artifact = {
      path: descriptor.path,
      sha256: descriptor.sha256,
      size: descriptor.size,
    };
    const installed = await installMacOSComputerLaunchAgentFiles({
      plan: provisioning.plan,
      serviceArtifact: artifact,
      serviceConfiguration: provisioning.serviceConfiguration,
      serviceVersion: descriptor.version,
      supervisorArtifact: artifact,
      supervisorConfiguration: provisioning.supervisorConfiguration,
      upgradeConfiguration: provisioning.upgradeConfiguration,
    });
    const installedSupervisor = await run(
      installed.supervisorExecutablePath,
      ["--invalid"],
      false,
    );
    const installedStable = await run(
      installed.stableArtifactPath,
      ["--invalid"],
      false,
    );
    if (
      installedSupervisor.exitCode === 0 ||
      installedStable.exitCode === 0 ||
      !installedSupervisor.stderr.includes("usage: rah-os-computer") ||
      !installedStable.stderr.includes("usage: rah-os-computer") ||
      (await readFile(
        join(provisioning.plan.kStateDirectory, "slots", "stable", "VERSION"),
        "utf8",
      )) !== descriptor.version
    ) {
      throw new Error("Computer SEA staging installer proof failed");
    }
  } finally {
    await rm(socketDirectory, { force: true, recursive: true });
  }
  process.stdout.write(
    `${JSON.stringify({
      ...descriptor,
      carrierSource: carrier.source,
      embeddedClaudeStreamJsonDriver: "proven",
      embeddedCodexAppServerDriver: "proven",
      embeddedProcessSupervisor: "proven",
      embeddedWorkerCli: "proven",
      signedPublication: "proven",
      stagedInstall: "proven",
    })}\n`,
  );
} finally {
  await rm(directory, { force: true, recursive: true });
}

async function run(executablePath, arguments_, captureReadiness) {
  const child = spawn(executablePath, arguments_, {
    env: Object.create(null),
    stdio: captureReadiness
      ? ["ignore", "pipe", "pipe", "pipe"]
      : ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  let stdout = "";
  let readiness = "";
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = bounded(stderr, chunk);
  });
  child.stdout.on("data", (chunk) => {
    stdout = bounded(stdout, chunk);
  });
  if (captureReadiness) {
    child.stdio[3].setEncoding("utf8");
    child.stdio[3].on("data", (chunk) => {
      readiness = bounded(readiness, chunk);
    });
  }
  const exitCode = await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Computer SEA gate timed out"));
    }, 30_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === null) {
        reject(
          new Error(`Computer SEA exited by ${signal ?? "unknown signal"}`),
        );
        return;
      }
      resolvePromise(code);
    });
  });
  return { exitCode, readiness, stderr, stdout };
}

function bounded(current, chunk) {
  const next = current + String(chunk);
  if (Buffer.byteLength(next, "utf8") > 1024 * 1_024) {
    throw new Error("Computer SEA gate output exceeded its bound");
  }
  return next;
}
