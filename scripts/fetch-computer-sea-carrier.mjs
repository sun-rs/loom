#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PINNED_CARRIERS = Object.freeze({
  "darwin-arm64": Object.freeze({
    archiveFile: "node-v26.8.1-darwin-arm64.tar.gz",
    archiveMember: "node-v26.8.1-darwin-arm64/bin/node",
    archiveSha256:
      "6e577fd0d9db776db82306629e441a9dace416702622aebdd171c9dfaa41f4d2",
    archiveSize: 57_813_947,
    nodeVersion: "v26.8.1",
  }),
});

export async function fetchPinnedComputerSeaCarrier(input) {
  const platformKey = `${process.platform}-${process.arch}`;
  const pin = PINNED_CARRIERS[platformKey];
  if (pin === undefined) {
    throw new Error(`no pinned Computer SEA carrier for ${platformKey}`);
  }
  const outputDirectory = absolutePath(
    input.outputDirectory,
    "outputDirectory",
  );
  await mkdir(outputDirectory, { mode: 0o700, recursive: true });
  const directoryMetadata = await lstat(outputDirectory);
  if (
    !directoryMetadata.isDirectory() ||
    directoryMetadata.isSymbolicLink() ||
    (directoryMetadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" &&
      directoryMetadata.uid !== process.getuid())
  ) {
    throw new Error("Computer SEA carrier directory must be owner-private");
  }
  const archivePath = join(outputDirectory, pin.archiveFile);
  const executablePath = join(outputDirectory, "node");
  await downloadPinnedArchive({ archivePath, pin });
  try {
    await execFileAsync(
      "/usr/bin/tar",
      [
        "-xzf",
        archivePath,
        "-C",
        outputDirectory,
        "--strip-components=2",
        pin.archiveMember,
      ],
      {
        env: Object.create(null),
        maxBuffer: 1024 * 1_024,
        timeout: 120_000,
        windowsHide: true,
      },
    );
  } finally {
    await rm(archivePath, { force: true });
  }
  const executableMetadata = await lstat(executablePath);
  if (
    !executableMetadata.isFile() ||
    executableMetadata.isSymbolicLink() ||
    (typeof process.getuid === "function" &&
      executableMetadata.uid !== process.getuid())
  ) {
    throw new Error("pinned Computer SEA carrier extraction is invalid");
  }
  await chmod(executablePath, 0o500);
  const { stdout } = await execFileAsync(executablePath, ["--version"], {
    env: Object.create(null),
    maxBuffer: 1024 * 1_024,
    timeout: 10_000,
    windowsHide: true,
  });
  if (stdout.trim() !== pin.nodeVersion) {
    throw new Error("pinned Computer SEA carrier version is invalid");
  }
  return Object.freeze({
    executablePath,
    nodeVersion: pin.nodeVersion,
    platformKey,
    source: `https://nodejs.org/dist/${pin.nodeVersion}/${pin.archiveFile}`,
  });
}

async function downloadPinnedArchive({ archivePath, pin }) {
  const url = `https://nodejs.org/dist/${pin.nodeVersion}/${pin.archiveFile}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new Error("pinned Computer SEA carrier download failed");
  }
  if (!response.ok || response.url !== url || response.body === null) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("pinned Computer SEA carrier source is invalid");
  }
  const handle = await open(
    archivePath,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  const digest = createHash("sha256");
  let received = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > pin.archiveSize) {
        throw new Error("pinned Computer SEA carrier size is invalid");
      }
      digest.update(value);
      await handle.writeFile(value);
    }
    if (
      received !== pin.archiveSize ||
      digest.digest("hex") !== pin.archiveSha256
    ) {
      throw new Error("pinned Computer SEA carrier digest is invalid");
    }
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(archivePath, { force: true });
    throw error;
  }
  await handle.close();
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

function usage() {
  return new Error(
    "usage: fetch-computer-sea-carrier --output-directory <absolute-path>",
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 4 || process.argv[2] !== "--output-directory") {
    throw usage();
  }
  const result = await fetchPinnedComputerSeaCarrier({
    outputDirectory: process.argv[3],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
