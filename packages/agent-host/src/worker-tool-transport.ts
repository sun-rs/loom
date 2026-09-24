import { isSea } from "node:sea";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";
import {
  createWorkerCredentialFileEnvironment,
  RAH_AGENT_TOOL_BIN_ENV,
  RAH_WORKER_CLI_ENV,
  RAH_WORKER_SESSION_FILE_ENV,
} from "./worker-credential-file.ts";

const WORKER_CLI_ENTRY_PATH = fileURLToPath(
  new URL("./worker-cli-entry.ts", import.meta.url),
);

export async function createWorkerToolTransportEnvironment(input: {
  credentialDirectory: string;
  revokeCredential: () => Promise<void> | void;
  workerAccessToken: string;
  workerApiOrigin: string;
}): Promise<ActivationEnvironmentLease> {
  const credentialLease = await createWorkerCredentialFileEnvironment(input);
  try {
    if (process.platform === "win32") {
      throw new Error("Worker CLI transport is not implemented for Windows");
    }
    const tokenPath = credentialLease.env[RAH_WORKER_SESSION_FILE_ENV];
    if (tokenPath === undefined) {
      throw new Error("Worker credential lease did not expose its token file");
    }
    const toolDirectory = dirname(tokenPath);
    const wrapperPath = await writeWorkerCliWrapper(toolDirectory);
    return Object.freeze({
      env: Object.freeze({
        ...credentialLease.env,
        [RAH_AGENT_TOOL_BIN_ENV]: toolDirectory,
        [RAH_WORKER_CLI_ENV]: wrapperPath,
      }),
      ...(credentialLease.redactions === undefined
        ? {}
        : { redactions: credentialLease.redactions }),
      ...(credentialLease.release === undefined
        ? {}
        : { release: credentialLease.release }),
    });
  } catch (error) {
    try {
      await credentialLease.release?.();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Worker CLI transport setup and credential cleanup failed",
      );
    }
    throw error;
  }
}

/** The `rah` Worker CLI wrapper the Provider finds on PATH / RAH_WORKER_CLI. */
export async function writeWorkerCliWrapper(
  directory: string,
): Promise<string> {
  const wrapperPath = join(directory, "rah");
  const invocation = isSea()
    ? [process.execPath, "__worker-cli"]
    : [process.execPath, WORKER_CLI_ENTRY_PATH];
  const wrapper = `#!/bin/sh\nexec ${invocation.map(shellQuote).join(" ")} "$@"\n`;
  const file = await open(wrapperPath, "wx", 0o700);
  try {
    await file.writeFile(wrapper, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  return wrapperPath;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
