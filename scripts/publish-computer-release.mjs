#!/usr/bin/env node

import {
  ComputerReleasePublisherError,
  publishComputerRelease,
} from "../packages/agent-host/src/index.ts";

const USAGE = `Usage:
  npm run publish:computer-release -- \\
    --version <semver> \\
    --root <absolute-staging-directory> \\
    --private-key <absolute-owner-private-ed25519-pkcs8-pem> \\
    --target <platform-key> <absolute-artifact-path> <release-file-name> \\
    [--target <platform-key> <absolute-artifact-path> <release-file-name> ...]

The command publishes into an owner-private local staging tree. It never
generates, prints, copies, or uploads the signing key. Upload/notarization is a
separate operator step.`;

function parseArguments(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return { help: true };
  }
  let version;
  let rootDirectory;
  let privateKeyPath;
  const targets = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--version") {
      if (version !== undefined || index + 1 >= argv.length) usageError();
      version = argv[++index];
    } else if (argument === "--root") {
      if (rootDirectory !== undefined || index + 1 >= argv.length) usageError();
      rootDirectory = argv[++index];
    } else if (argument === "--private-key") {
      if (privateKeyPath !== undefined || index + 1 >= argv.length)
        usageError();
      privateKeyPath = argv[++index];
    } else if (argument === "--target") {
      if (index + 3 >= argv.length) usageError();
      targets.push({
        platformKey: argv[++index],
        artifactPath: argv[++index],
        file: argv[++index],
      });
    } else {
      usageError();
    }
  }
  if (
    version === undefined ||
    rootDirectory === undefined ||
    privateKeyPath === undefined ||
    targets.length === 0
  ) {
    usageError();
  }
  return {
    help: false,
    privateKeyPath,
    rootDirectory,
    targets,
    version,
  };
}

function usageError() {
  throw new Error(USAGE);
}

try {
  const input = parseArguments(process.argv.slice(2));
  if (input.help) {
    process.stdout.write(`${USAGE}\n`);
  } else {
    const publication = await publishComputerRelease(input);
    process.stdout.write(
      `${JSON.stringify({
        manifestPath: publication.manifestPath,
        pointerPath: publication.pointerPath,
        releaseDirectory: publication.releaseDirectory,
        targets: publication.targets,
        version: publication.version,
      })}\n`,
    );
  }
} catch (error) {
  if (error instanceof ComputerReleasePublisherError) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
  } else if (error instanceof Error) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write("Computer release publication failed\n");
  }
  process.exitCode = 1;
}
