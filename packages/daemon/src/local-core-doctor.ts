import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import type { LocalRuntimeInventoryEntry } from "@rah-os/protocol";

import { inspectLanCertificate } from "./lan-certificate-provisioning.ts";
import { validateLanTlsIdentity } from "./lan-workbench-gateway.ts";

export type LocalCoreDoctorCheck = {
  detail: string;
  id: "lan-tls" | "runtime" | "state" | "web-build" | "workspace";
  status: "fail" | "notice" | "pass";
};

export type LocalCoreDoctorReport = {
  checks: LocalCoreDoctorCheck[];
  manualActions: Array<"trust-lan-ca-on-client-devices">;
  readyToStart: boolean;
  runtimes: Array<{
    available: boolean;
    displayName: string;
    executable: string;
    resolvedExecutablePath?: string;
    version?: string;
  }>;
};

export async function diagnoseLocalCore(input: {
  runtimeInventory: readonly LocalRuntimeInventoryEntry[];
  stateDirectory: string;
  staticDirectory: string;
  tls?:
    | { directory: string; kind: "managed"; publicHostname: string }
    | {
        certificatePath: string;
        kind: "external";
        privateKeyPath: string;
        publicHostname: string;
      };
  workspaceCwd: string;
}): Promise<LocalCoreDoctorReport> {
  const checks: LocalCoreDoctorCheck[] = [];
  checks.push(directoryCheck("workspace", input.workspaceCwd, false));
  checks.push(webBuildCheck(input.staticDirectory));
  checks.push(stateCheck(input.stateDirectory));

  const availableRuntimes = input.runtimeInventory.filter(
    ({ available }) => available,
  );
  checks.push({
    detail:
      availableRuntimes.length === 0
        ? "No supported local Agent CLI was discovered"
        : `${String(availableRuntimes.length)} supported local Agent CLI runtime(s) are available`,
    id: "runtime",
    status: availableRuntimes.length === 0 ? "fail" : "pass",
  });

  const manualActions: LocalCoreDoctorReport["manualActions"] = [];
  if (input.tls !== undefined) {
    try {
      if (input.tls.kind === "managed") {
        const identity = inspectLanCertificate({
          directory: input.tls.directory,
          publicHostname: input.tls.publicHostname,
        });
        if (identity === undefined) {
          checks.push({
            detail:
              "LAN TLS identity is not provisioned for the requested hostname",
            id: "lan-tls",
            status: "fail",
          });
        } else {
          checks.push({
            detail: `Managed LAN TLS identity is valid until ${identity.validTo}; CA ${identity.caFingerprint256}`,
            id: "lan-tls",
            status: "pass",
          });
          manualActions.push("trust-lan-ca-on-client-devices");
        }
      } else {
        const certificate = validateLanTlsIdentity(
          {
            certificate: readCertificateFile(input.tls.certificatePath),
            privateKey: readPrivateKeyFile(input.tls.privateKeyPath),
          },
          input.tls.publicHostname,
          Date.now(),
        );
        checks.push({
          detail: `External LAN TLS identity is valid until ${new Date(certificate.validTo).toISOString()}; certificate ${certificate.fingerprint256}`,
          id: "lan-tls",
          status: "pass",
        });
      }
    } catch (error) {
      checks.push({
        detail: boundedError(error),
        id: "lan-tls",
        status: "fail",
      });
    }
  }

  return {
    checks,
    manualActions,
    readyToStart: checks.every(({ status }) => status !== "fail"),
    runtimes: input.runtimeInventory.map(
      ({
        available,
        displayName,
        executable,
        resolvedExecutablePath,
        version,
      }) => ({
        available,
        displayName,
        executable,
        ...(resolvedExecutablePath === undefined
          ? {}
          : { resolvedExecutablePath }),
        ...(version === undefined ? {} : { version }),
      }),
    ),
  };
}

function readCertificateFile(path: string): Buffer {
  return readBoundedRegularFile(path, false, "LAN certificate");
}

function readPrivateKeyFile(path: string): Buffer {
  return readBoundedRegularFile(path, true, "LAN private key");
}

function readBoundedRegularFile(
  path: string,
  ownerPrivate: boolean,
  label: string,
): Buffer {
  if (!isAbsolute(path) || !existsSync(path)) {
    throw new Error(`${label} path must be an existing absolute file`);
  }
  const metadata = lstatSync(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > 1024 * 1024
  ) {
    throw new Error(`${label} must be a bounded regular file`);
  }
  if (ownerPrivate && (metadata.mode & 0o077) !== 0) {
    throw new Error(`${label} must be owner-private`);
  }
  return readFileSync(path);
}

function webBuildCheck(staticDirectory: string): LocalCoreDoctorCheck {
  if (!isAbsolute(staticDirectory)) {
    return {
      detail: "Production Web build directory must be absolute",
      id: "web-build",
      status: "fail",
    };
  }
  const indexPath = join(staticDirectory, "index.html");
  if (!existsSync(indexPath)) {
    return {
      detail:
        "Production Web bundle is missing; run npm run build:web:workbench",
      id: "web-build",
      status: "fail",
    };
  }
  const metadata = lstatSync(indexPath);
  return metadata.isFile() && !metadata.isSymbolicLink()
    ? {
        detail: "Production Web bundle is present",
        id: "web-build",
        status: "pass",
      }
    : {
        detail: "Production Web index must be a regular file",
        id: "web-build",
        status: "fail",
      };
}

function stateCheck(stateDirectory: string): LocalCoreDoctorCheck {
  if (!isAbsolute(stateDirectory)) {
    return {
      detail: "Core state directory must be absolute",
      id: "state",
      status: "fail",
    };
  }
  if (!existsSync(stateDirectory)) {
    return {
      detail: "Core state is uninitialized and will be created on first start",
      id: "state",
      status: "notice",
    };
  }
  const directory = privateDirectoryStatus(stateDirectory);
  if (directory !== undefined) {
    return { detail: directory, id: "state", status: "fail" };
  }
  for (const filename of [
    "host.token",
    "human.token",
    "room.db",
    "runtime-registry.db",
    "workbench.json",
  ]) {
    const path = join(stateDirectory, filename);
    if (!existsSync(path)) {
      return {
        detail: `Initialized Core state is missing ${filename}`,
        id: "state",
        status: "fail",
      };
    }
    const metadata = lstatSync(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0
    ) {
      return {
        detail: `Core state file ${filename} is not owner-private and regular`,
        id: "state",
        status: "fail",
      };
    }
  }
  return {
    detail: "Persistent Core state has the expected private file boundary",
    id: "state",
    status: "pass",
  };
}

function directoryCheck(
  id: "workspace",
  path: string,
  ownerPrivate: boolean,
): LocalCoreDoctorCheck {
  if (!isAbsolute(path) || !existsSync(path)) {
    return {
      detail: "Workspace must be an existing absolute directory",
      id,
      status: "fail",
    };
  }
  const metadata = lstatSync(path);
  const valid =
    metadata.isDirectory() &&
    !metadata.isSymbolicLink() &&
    (!ownerPrivate || (metadata.mode & 0o077) === 0);
  return valid
    ? { detail: "Workspace directory is available", id, status: "pass" }
    : {
        detail: "Workspace must be a real directory",
        id,
        status: "fail",
      };
}

function privateDirectoryStatus(path: string): string | undefined {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    return "Core state must be a real directory";
  }
  return (metadata.mode & 0o077) === 0
    ? undefined
    : "Core state directory must be owner-private";
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown failure";
  return message.slice(0, 512);
}
